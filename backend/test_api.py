import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError

from app import app
from generate import CASES


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def upload(self, data, name):
        response = self.client.post('/api/blue/scan', data={'file': (BytesIO(data), name)})
        response.request.environ['wsgi.input'].close()
        return response

    def test_every_red_case_through_blue_api(self):
        for case, _host, expected, qr in CASES:
            with self.subTest(case=case):
                for artifact, suffix in [('email', 'eml')] + ([('image', 'png')] if qr else []):
                    download = self.client.post('/api/red/generate', json={'case': case, 'artifact': artifact}, buffered=True)
                    self.assertEqual(download.status_code, 200)
                    self.assertIn('attachment', download.headers['Content-Disposition'])
                    report = self.upload(download.data, f'{case}.{suffix}')
                    self.assertEqual(report.status_code, 200)
                    self.assertEqual(report.json['scan_errors'], [])
                    self.assertEqual(report.json['file'], f'{case}.{suffix}')
                    rules = {item['rule'] for item in report.json['findings']}
                    self.assertEqual(rules, set() if expected == 'clean' else {expected})

    def test_qr_reports_host_for_clean_and_misleading_payloads(self):
        for case, destination in [('clean-qr', 'campusdesk.test'), ('userinfo-qr', 'notice.test')]:
            with self.subTest(case=case):
                sample = self.client.post('/api/red/generate', json={'case': case, 'artifact': 'image'})
                report = self.upload(sample.data, f'{case}.png').json
                self.assertEqual(report['urls'][0]['destination'], destination)
                self.assertEqual(report['urls'][0]['source'], 'qr:image')

    def test_boundary_errors(self):
        self.assertEqual(self.client.post('/api/red/generate', json={'case': '../secret'}).status_code, 400)
        self.assertEqual(self.upload(b'data', 'case.pdf').status_code, 415)
        self.assertEqual(self.upload(b'', 'case.eml').status_code, 400)
        self.assertEqual(self.upload(b'x' * 5_000_001, 'case.eml').status_code, 413)
        self.assertEqual(self.upload(b'broken PNG', 'case.png').json['result'], 'incomplete')
        self.assertEqual(self.client.post('/api/red/generate', json={'case': 'clean'},
                                         headers={'Origin': 'https://outside.test'}).status_code, 403)


    def test_evidence_validates_batch_and_skips_reserved_names(self):
        url = '/api/red/evidence'
        with patch('app.load_registry') as bootstrap:
            for domains in ([], ['a.test'] * 4, ['https://bad.test'], [None]):
                self.assertEqual(self.client.post(url, json={'domains': domains}).status_code, 400)
            response = self.client.post(url, json={'domains': ['A.test.', 'a.test']})
            self.assertEqual(response.status_code, 200)
            result, = response.json['results']
            self.assertEqual(result['domain'], 'a.test')
            self.assertEqual(result['status'], 'unsupported_suffix')
            self.assertEqual({row['status'] for row in result['evidence'].values()}, {'skipped'})
            bootstrap.assert_not_called()
        self.assertEqual(self.client.post(url, json={'domains': ['a.test']},
                                         headers={'Origin': 'https://outside.test'}).status_code, 403)

    def test_rdap_refusal_preserves_dns_and_certificate_results(self):
        def respond(request, timeout):
            url = request.full_url
            if url.startswith('https://rdap.example.org/'):
                raise HTTPError(url, 403, 'Forbidden', {}, BytesIO())
            if url.endswith('type=A'):
                return BytesIO(b'{"Status":0,"Answer":[{"type":1,"data":"192.0.2.1"}]}')
            if url.endswith('type=AAAA'):
                return BytesIO(b'{"Status":0}')
            return BytesIO(b'[{"id":"1","dns_names":["example.org"]}]')

        with patch('app.load_registry', return_value={'org': 'https://rdap.example.org'}), \
                patch('app.build_opener') as build:
            build.return_value.open.side_effect = respond
            response = self.client.post('/api/red/evidence', json={'domains': ['example.org']})
        self.assertEqual(response.status_code, 200)
        result, = response.json['results']
        self.assertEqual((result['status'], result['http_status']), ('unavailable', 403))
        evidence = result['evidence']
        self.assertEqual(evidence['dns_a']['addresses'], ['192.0.2.1'])
        self.assertEqual(evidence['dns_aaaa']['status'], 'no_records')
        self.assertEqual(evidence['ct']['status'], 'exact_match_found')


if __name__ == '__main__':
    unittest.main()
