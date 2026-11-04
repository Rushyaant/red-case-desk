import unittest
from io import BytesIO

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

    def test_boundary_errors(self):
        self.assertEqual(self.client.post('/api/red/generate', json={'case': '../secret'}).status_code, 400)
        self.assertEqual(self.upload(b'data', 'case.pdf').status_code, 415)
        self.assertEqual(self.upload(b'', 'case.eml').status_code, 400)
        self.assertEqual(self.upload(b'x' * 5_000_001, 'case.eml').status_code, 413)
        self.assertEqual(self.upload(b'broken PNG', 'case.png').json['result'], 'incomplete')
        self.assertEqual(self.client.post('/api/red/generate', json={'case': 'clean'},
                                         headers={'Origin': 'https://outside.test'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
