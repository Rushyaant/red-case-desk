"""Check a small batch for RDAP records and optional DNS and certificate evidence."""

import argparse
from http.client import HTTPException
from ipaddress import ip_address
import json
from pathlib import Path
from time import sleep
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from domain_variants import LABEL


BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
MAX_DOMAINS = 10
MAX_JSON_BYTES = 2_000_000
DNS_URL = 'https://dns.google/resolve'
CT_URL = 'https://api.certspotter.com/v1/issuances'
LAB_SUFFIXES = ('.test', '.example', '.invalid', '.localhost', '.local', '.internal', '.onion', '.home.arpa')


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_json(stream):
    data = stream.read(MAX_JSON_BYTES + 1)
    if len(data) > MAX_JSON_BYTES:
        raise ValueError('JSON exceeds the size limit')
    try:
        return json.loads(data)
    except (ValueError, RecursionError) as error:
        raise ValueError('invalid JSON') from error


def normalize_domain(value):
    if isinstance(value, str) and value.isascii():
        domain = value.strip().lower().removesuffix('.')
        labels = domain.split('.')
        if len(domain) <= 253 and len(labels) >= 2 and all(LABEL.fullmatch(label) for label in labels):
            if not labels[-1].isdigit():
                return domain
    raise ValueError('enter a domain name in ASCII or Punycode')


def open_rdap(opener, url):
    request = Request(url, headers={'Accept': 'application/rdap+json, application/json'})
    return opener.open(request, timeout=8)


def load_registry(opener):
    with open_rdap(opener, BOOTSTRAP_URL) as response:
        data = read_json(response)
    services = data.get('services') if isinstance(data, dict) else None
    if not isinstance(services, list):
        raise ValueError('IANA bootstrap has no service list')
    registry = {}
    for entry in services:
        if (not isinstance(entry, list) or len(entry) != 2
                or any(not isinstance(group, list) or not all(isinstance(item, str) for item in group)
                       for group in entry)):
            raise ValueError('IANA bootstrap contains an invalid service entry')
        suffixes, urls = entry
        for url in urls:
            parts = urlsplit(url)
            if (parts.scheme == 'https' and parts.hostname and parts.username is None
                    and not parts.query and not parts.fragment):
                for suffix in suffixes:
                    registry.setdefault(suffix.lower(), url.rstrip('/'))
                break
    if not registry:
        raise ValueError('IANA bootstrap has no HTTPS services')
    return registry


def service_for(domain, registry):
    labels = domain.split('.')
    for index in range(1, len(labels)):
        service = registry.get('.'.join(labels[index:]))
        if service:
            return service
    return None


def check_domain(opener, domain, service):
    row = {'domain': domain, 'service': service}
    try:
        with open_rdap(opener, f'{service}/domain/{domain}') as response:
            data = read_json(response)
    except HTTPError as error:
        with error:
            if error.code == 404:
                return dict(row, status='not_found', http_status=404)
            if error.code == 429:
                return dict(row, status='rate_limited', http_status=429,
                            retry_after=error.headers.get('Retry-After'))
            return dict(row, status='unavailable', http_status=error.code)
    except (OSError, HTTPException, ValueError) as error:
        return dict(row, status='unavailable', reason=str(error))

    if isinstance(data, dict) and data.get('objectClassName') == 'domain':
        returned_name = data.get('ldhName')
        if isinstance(returned_name, str) and returned_name.lower().removesuffix('.') == domain:
            return dict(row, status='registered')
    return dict(row, status='unavailable', reason='RDAP did not return a matching domain object')


def dns_result(data, record_type):
    if not isinstance(data, dict) or type(data.get('Status')) is not int:
        raise ValueError('invalid DNS response')
    code = data['Status']
    if data.get('TC'):
        return {'status': 'unavailable', 'reason': 'truncated DNS response', 'rcode': code}
    if code == 3:
        return {'status': 'nxdomain'}
    if code != 0:
        return {'status': 'unavailable', 'rcode': code}
    answers = data.get('Answer', [])
    if not isinstance(answers, list) or any(not isinstance(answer, dict) for answer in answers):
        raise ValueError('invalid DNS answer section')
    number, version = (1, 4) if record_type == 'A' else (28, 6)
    addresses = set()
    for answer in answers:
        if answer.get('type') == number:
            value = answer.get('data')
            if not isinstance(value, str):
                raise ValueError('invalid address in DNS answer')
            address = ip_address(value)
            if address.version != version:
                raise ValueError('invalid address in DNS answer')
            addresses.add(str(address))
    return {'status': 'records_found' if addresses else 'no_records', 'addresses': sorted(addresses)}


def ct_result(data, domain):
    if not isinstance(data, list):
        raise ValueError('invalid certificate transparency response')
    matches = set()
    for issuance in data:
        names = issuance.get('dns_names') if isinstance(issuance, dict) else None
        if (not isinstance(names, list) or not all(isinstance(name, str) for name in names)
                or not isinstance(issuance.get('id'), str)):
            raise ValueError('invalid certificate transparency issuance')
        if any(name.lower().removesuffix('.') == domain for name in names):
            matches.add(issuance['id'])
    return {'status': 'exact_match_found' if matches else 'no_exact_match',
            'scope': 'first_page_unexpired_issuances', 'match_count': len(matches),
            'sample_ids': sorted(matches)[:3]}


def collect_evidence(opener, domain, limited):
    evidence = {}
    for key, source, url, params in (
        ('dns_a', 'Google Public DNS', DNS_URL, {'name': domain, 'type': 'A'}),
        ('dns_aaaa', 'Google Public DNS', DNS_URL, {'name': domain, 'type': 'AAAA'}),
        ('ct', 'Cert Spotter', CT_URL, {'domain': domain, 'expand': 'dns_names'}),
    ):
        if domain.endswith(LAB_SUFFIXES):
            result = {'status': 'skipped', 'reason': 'local or reserved suffix'}
        elif source in limited:
            result = {'status': 'skipped', 'reason': 'previous query was rate limited'}
        else:
            try:
                request = Request(f'{url}?{urlencode(params)}', headers={'Accept': 'application/json'})
                with opener.open(request, timeout=8) as response:
                    data = read_json(response)
                result = ct_result(data, domain) if key == 'ct' else dns_result(data, params['type'])
            except HTTPError as error:
                with error:
                    result = {'status': 'unavailable', 'http_status': error.code}
                    if error.code == 429:
                        limited.add(source)
                        result.update(status='rate_limited', retry_after=error.headers.get('Retry-After'))
            except (OSError, HTTPException, ValueError) as error:
                result = {'status': 'unavailable', 'reason': str(error)}
        evidence[key] = dict(result, source=source)
    return evidence


def check_targets(opener, targets, *, evidence=False, registry_error=None):
    results = []
    queried = False
    rate_limited = False
    evidence_limited = set()
    for domain, service in targets:
        network_target = service or (evidence and not domain.endswith(LAB_SUFFIXES))
        if network_target and queried:
            sleep(1)
        queried = queried or bool(network_target)
        if registry_error is not None and not domain.endswith(LAB_SUFFIXES):
            row = {'domain': domain, 'status': 'unavailable', 'reason': registry_error}
        elif service is None:
            row = {'domain': domain, 'status': 'unsupported_suffix'}
        elif rate_limited:
            row = {'domain': domain, 'status': 'skipped', 'reason': 'previous query was rate limited'}
        else:
            row = check_domain(opener, domain, service)
            rate_limited = row['status'] == 'rate_limited'
        if evidence:
            row['evidence'] = collect_evidence(opener, domain, evidence_limited)
        results.append(row)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('domains', nargs='*', help='explicit domain names to check')
    parser.add_argument('--from-json', type=Path, help='JSON candidates from domain_variants.py')
    parser.add_argument('--limit', type=int, choices=range(1, MAX_DOMAINS + 1), default=5,
                        help='maximum domains from a JSON file, default 5')
    parser.add_argument('--evidence', action='store_true', help='also query public DNS and certificate transparency')
    args = parser.parse_args()
    if bool(args.domains) == bool(args.from_json):
        parser.error('provide explicit domain names or --from-json')

    opener = build_opener(NoRedirects())
    try:
        names = args.domains
        if args.from_json:
            with args.from_json.open('rb') as stream:
                candidates = read_json(stream)
            if not isinstance(candidates, list) or any(not isinstance(row, dict) for row in candidates):
                raise ValueError('candidate file must be a list of domain objects')
            names = [row.get('domain') for row in candidates]
        domains = list(dict.fromkeys(normalize_domain(name) for name in names))
        if args.domains and len(domains) > MAX_DOMAINS:
            raise ValueError(f'provide at most {MAX_DOMAINS} distinct domains')
    except (OSError, HTTPException, ValueError) as error:
        parser.exit(2, f'error: {error}\n')

    registry_error = None
    try:
        registry = load_registry(opener)
    except (OSError, HTTPException, ValueError) as error:
        if not args.evidence:
            parser.exit(2, f'error: {error}\n')
        registry, registry_error = {}, str(error)

    targets = [(domain, service_for(domain, registry)) for domain in domains]
    if args.from_json:
        targets = [(domain, service) for domain, service in targets
                   if service or (args.evidence and not domain.endswith(LAB_SUFFIXES))][:args.limit]
        if not targets:
            parser.exit(2, 'error: candidate file has no eligible domains for the selected checks\n')

    results = check_targets(opener, targets, evidence=args.evidence, registry_error=registry_error)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
