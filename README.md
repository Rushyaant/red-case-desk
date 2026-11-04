# Phishing web lab

## Milestone 1 Flask API

The planned React apps use two distinct workflows. The red interface
generates and downloads a marked simulation artifact. The blue interface
accepts a saved artifact and explains its findings. Both use the local Flask
API in this milestone.

On the project laptop, Flask, qrcode, Pillow, and the system ZBar library
were available when the API was tested. From this folder:

```bash
cd backend
python3 -B -m unittest -v test_api
python3 app.py
```

Keep Flask running. In another terminal, download a synthetic message and
submit its bytes to the scanner:

```bash
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS http://127.0.0.1:8000/api/red/cases
curl -fsS http://127.0.0.1:8000/api/red/generate \
  -H 'Content-Type: application/json' \
  -d '{"case":"userinfo-qr","artifact":"email"}' \
  -o /tmp/phishing-web-demo.eml
curl -fsS http://127.0.0.1:8000/api/blue/scan \
  -F 'file=@/tmp/phishing-web-demo.eml'
```

`-d` sends a JSON request. `-o` saves the response as an email file.
`-F` uploads that saved file as multipart form data. Find `url_userinfo` and
`destination: notice.test` in the report. The QR contains a familiar domain
string before `@`, which the parser separates from the destination hostname.

For a control, generate the `clean-qr` case and submit it again. Compare
`no_indicators` with the `review` result above. The test suite runs all ten
email cases and three standalone QR images through both API routes.

## Hosting decision

GitHub Pages can serve built React files as a static site. A Flask API needs
a server runtime. Vercel has an official Flask example, so it is a candidate
for hosting an API. The blue scanner needs native ZBar, which must be proven
in the target environment before choosing a host for that service.

- [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Vercel Flask example](https://github.com/vercel/examples/tree/main/python/flask)

The local API binds to loopback, accepts same-origin browser posts, and
processes uploaded files in temporary directories. An Internet-facing version
requires a separate deployment configuration and an explicit upload policy.
