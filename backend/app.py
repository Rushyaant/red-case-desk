"""Local Flask API for the red simulation and blue triage web apps."""

from http.client import HTTPException
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from urllib.request import build_opener

from flask import Flask, request, send_file
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

from domain_variants import generate_variants
from generate import CASES, generate
from rdap_check import LAB_SUFFIXES, NoRedirects, check_targets, load_registry, normalize_domain, service_for
from triage import MAX_BYTES, scan

app = Flask(__name__)
app.config.update(MAX_CONTENT_LENGTH=MAX_BYTES + 64_000,
                  TRUSTED_HOSTS=['localhost', '127.0.0.1'])
CONFUSABLES_FILE = Path(__file__).resolve().parent / 'data' / 'confusables-16.0.0.txt'
MAX_EVIDENCE_DOMAINS = 3
evidence_lock = Lock()


@app.before_request
def require_local_origin():
    origin = request.headers.get('Origin')
    if request.method == 'POST' and origin and origin != request.host_url.rstrip('/'):
        return {'error': 'Use the lab interface on the same origin.'}, 403


@app.after_request
def prevent_cache(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.errorhandler(413)
def too_large(_error):
    return {'error': 'Upload must be at most 5,000,000 bytes.'}, 413


@app.get('/api/health')
def health():
    return {'status': 'ready'}


@app.get('/api/red/cases')
def cases():
    return [{'id': name, 'artifacts': ['email', 'image'] if qr else ['email']}
            for name, _authority, _expected, qr in CASES]


@app.post('/api/red/generate')
def generate_case():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return {'error': 'Expected a JSON object with a case ID.'}, 400
    case_id = body.get('case')
    artifact = body.get('artifact', 'email')
    case = next((row for row in CASES if row[0] == case_id), None)
    if case is None or artifact not in ('email', 'image'):
        return {'error': 'Choose a listed case and artifact type.'}, 400
    if artifact == 'image' and not case[3]:
        return {'error': 'This case only produces an email.'}, 400
    with TemporaryDirectory() as directory:
        output = Path(directory) / 'fixture'
        row, = generate(output, selected=case_id)
        name = row[artifact]
        data = (output / name).read_bytes()
    mime = 'message/rfc822' if artifact == 'email' else 'image/png'
    return send_file(BytesIO(data), mimetype=mime, as_attachment=True, download_name=name)


@app.post('/api/blue/scan')
def scan_upload():
    upload = request.files.get('file')
    if upload is None or not upload.filename:
        return {'error': 'Choose a saved EML, PNG, or JPEG file.'}, 400
    name = secure_filename(upload.filename)
    suffix = Path(name).suffix.lower()
    if suffix not in {'.eml', '.png', '.jpg', '.jpeg'}:
        return {'error': 'Supported inputs are EML, PNG, and JPEG.'}, 415
    data = upload.stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return too_large(None)
    if not data:
        return {'error': 'The uploaded file is empty.'}, 400
    with TemporaryDirectory() as directory:
        path = Path(directory) / f'input{suffix}'
        path.write_bytes(data)
        try:
            report = scan(path, 'campusdesk.test')
        except (ValueError, RecursionError):
            return {'error': 'The uploaded file could not be inspected.'}, 422
    report['file'] = name
    return report


@app.post('/api/red/variants')
def red_variants():
    request.max_content_length = 4096
    try:
        body = request.get_json(silent=True)
    except RequestEntityTooLarge:
        return {'error': 'Domain requests must be at most 4 KB.'}, 413
    if not isinstance(body, dict) or not isinstance(body.get('domain'), str):
        return {'error': 'Enter a domain, such as campusdesk.test.'}, 400
    tlds = body.get('tlds', [])
    unicode_enabled = body.get('unicode', False)
    if (not isinstance(tlds, list) or len(tlds) > 8
            or not all(isinstance(tld, str) for tld in tlds)
            or not isinstance(unicode_enabled, bool)):
        return {'error': 'Provide up to eight suffixes and a valid Unicode setting.'}, 400
    domain = body['domain'].strip()
    try:
        variants = generate_variants(domain, tlds=tlds,
                                     confusables=CONFUSABLES_FILE if unicode_enabled else None)
    except ValueError as error:
        return {'error': str(error)}, 400
    except OSError:
        return {'error': 'The local Unicode table is unavailable.'}, 503
    return {'domain': domain.lower().removesuffix('.'), 'variants': variants}


@app.post('/api/red/evidence')
def red_evidence():
    request.max_content_length = 4096
    try:
        body = request.get_json(silent=True)
    except RequestEntityTooLarge:
        return {'error': 'Evidence requests must be at most 4 KB.'}, 413
    names = body.get('domains') if isinstance(body, dict) else None
    if not isinstance(names, list) or not 1 <= len(names) <= MAX_EVIDENCE_DOMAINS:
        return {'error': f'Select one to {MAX_EVIDENCE_DOMAINS} domains.'}, 400
    try:
        domains = list(dict.fromkeys(normalize_domain(name) for name in names))
    except ValueError as error:
        return {'error': str(error)}, 400

    if not evidence_lock.acquire(blocking=False):
        return {'error': 'An evidence check is already running. Try again when it finishes.'}, 429
    try:
        opener = build_opener(NoRedirects())
        registry, registry_error = {}, None
        if any(not domain.endswith(LAB_SUFFIXES) for domain in domains):
            try:
                registry = load_registry(opener)
            except (OSError, HTTPException, ValueError) as error:
                registry_error = str(error)
        targets = [(domain, None if domain.endswith(LAB_SUFFIXES) else service_for(domain, registry))
                   for domain in domains]
        return {'results': check_targets(opener, targets, evidence=True, registry_error=registry_error)}
    finally:
        evidence_lock.release()


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8000)
