"""Inspect saved emails and QR images locally and produce a JSON evidence report."""

import argparse
import hashlib
import json
import re
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image

from qr_scan import decode_qr

MAX_BYTES = 5_000_000
URL = re.compile(r'https?://[^\s<>"\']+', re.IGNORECASE)
# shortcut: a small teaching map, not a Unicode-wide confusable implementation.
CONFUSABLES = str.maketrans('аеорсхуі', 'aeopcxyi')


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        self.urls.extend(value for key, value in attributes
                         if tag == 'a' and key == 'href' and value is not None)

    def handle_data(self, text):
        self.urls.extend(text_urls(text))


def text_urls(text):
    return [url.rstrip('.,;!?)]}') for url in URL.findall(text)]


def hostname(value):
    value = value.removesuffix('.').encode('idna').decode('ascii').lower()
    labels = value.split('.')
    if len(value) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                                   for label in labels):
        raise ValueError('invalid hostname')
    return value


def similar(left, right):
    if len(left) > len(right):
        left, right = right, left
    if len(right) == len(left) + 1:
        return any(right[:i] + right[i + 1:] == left for i in range(len(right)))
    if len(left) != len(right):
        return False
    differences = [i for i, (a, b) in enumerate(zip(left, right)) if a != b]
    if len(differences) == 1:
        return True
    if len(differences) == 2:
        i, j = differences
        return j == i + 1 and left[i] == right[j] and left[j] == right[i]
    return False


def inspect_url(raw, source, trusted):
    try:
        if any(ord(char) <= 32 or ord(char) == 127 for char in raw) or '\\' in raw:
            raise ValueError('ambiguous URL characters')
        url = urlsplit(raw)
        if url.scheme not in {'http', 'https'}:
            return [{'rule': 'unsupported_url_scheme', 'source': source, 'value': raw}]
        if not url.hostname:
            raise ValueError('missing hostname')
        host = hostname(url.hostname)
        port = url.port  # Also validates the port field.
    except ValueError:
        return [{'rule': 'invalid_url', 'source': source, 'value': raw}]

    rules = []
    if url.username is not None:
        rules.append('url_userinfo')
    if host != trusted and not host.endswith('.' + trusted):
        if '.' + trusted + '.' in '.' + host:
            rules.append('misleading_subdomain')
        else:
            # shortcut: compare the configured domain's label count, without a public suffix database.
            tail = '.'.join(host.split('.')[-len(trusted.split('.')):])
            try:
                decoded = tail.encode('ascii').decode('idna').translate(CONFUSABLES)
            except UnicodeError:
                return [{'rule': 'invalid_url', 'source': source, 'value': raw}]
            if decoded == trusted or similar(decoded, trusted):
                rules.append('lookalike_host')
    return [{'rule': rule, 'source': source, 'value': raw, 'destination': host, 'port': port}
            for rule in rules]


def scan(path, trusted):
    with path.open('rb') as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('input exceeds five million bytes')
    findings, urls, attachments, errors = [], [], [], []

    def scan_image(content, source):
        try:
            urls.extend((payload, source) for payload in decode_qr(content))
        except (OSError, ValueError, Image.DecompressionBombError) as error:
            errors.append({'source': source, 'error': str(error)})

    if path.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
        scan_image(data, 'qr:image')
        if not urls and not errors:
            errors.append({'source': 'qr:image', 'error': 'no QR payload decoded'})
    elif path.suffix.lower() == '.eml':
        message = BytesParser(policy=policy.default).parsebytes(data)
        domains = []
        for header in ('From', 'Reply-To'):
            value = message[header]
            domains.append({address.domain.casefold().removesuffix('.') for address in value.addresses
                            if address.domain} if value else set())
        if all(domains) and domains[0] != domains[1]:
            findings.append({'rule': 'reply_to_mismatch', 'source': 'headers',
                             'from_domains': sorted(domains[0]), 'reply_to_domains': sorted(domains[1])})
        for index, part in enumerate(message.walk(), 1):
            if part.is_multipart():
                errors.extend({'source': f'part:{index}', 'error': type(defect).__name__}
                              for defect in part.defects)
                continue
            kind = part.get_content_type()
            name = part.get_filename()
            source = f'part:{index}'
            if name or part.get_content_disposition() == 'attachment' or kind.startswith('image/'):
                payload = part.get_payload(decode=True) or b''
                attachments.append({'part': source, 'filename': name, 'type': kind,
                                    'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()})
                if kind in {'image/png', 'image/jpeg'} or (name and Path(name).suffix.lower() in {'.png', '.jpg', '.jpeg'}):
                    scan_image(payload, f'qr:{source}')
            elif kind in {'text/plain', 'text/html'}:
                try:
                    content = part.get_content()
                    if kind == 'text/html':
                        parser = Links()
                        parser.feed(content)
                        parser.close()
                        extracted = parser.urls
                    else:
                        extracted = text_urls(content)
                    urls.extend((url, source) for url in extracted)
                except (LookupError, UnicodeError, ValueError) as error:
                    errors.append({'source': source, 'error': str(error)})
            for defect in part.defects:
                errors.append({'source': source, 'error': type(defect).__name__})
    else:
        raise ValueError('expected .eml, .png, .jpg or .jpeg')

    urls = list(dict.fromkeys(urls))
    for url, source in urls:
        findings.extend(inspect_url(url, source, trusted))
    return {'file': str(path), 'trusted_domain': trusted,
            'result': 'review' if findings else 'incomplete' if errors else 'no_indicators',
            'urls': [{'value': url, 'source': source} for url, source in urls],
            'attachments': attachments, 'findings': findings, 'scan_errors': errors}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, nargs='+')
    parser.add_argument('--trusted-domain', default='campusdesk.test')
    args = parser.parse_args()
    try:
        trusted = hostname(args.trusted_domain)
        reports = [scan(path, trusted) for path in args.input]
    except (OSError, ValueError, RecursionError) as error:
        parser.exit(2, f'error: {error}\n')
    print(json.dumps(reports, indent=2))
