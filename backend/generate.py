"""Generate an offline phishing awareness corpus for a fictional help desk."""

import argparse
import json
from email.message import EmailMessage
from email.policy import SMTP
from io import BytesIO
from pathlib import Path

import qrcode


CASES = [
    ('clean', 'campusdesk.test', 'clean', False),
    ('clean-qr', 'campusdesk.test', 'clean', True),
    ('omission', 'campudesk.test', 'lookalike_host', False),
    ('repetition', 'campussdesk.test', 'lookalike_host', False),
    ('swap', 'campudsesk.test', 'lookalike_host', False),
    ('keyboard', 'campusdezk.test', 'lookalike_host', False),
    ('homoglyph-qr', 'cаmpusdesk.test'.encode('idna').decode('ascii'), 'lookalike_host', True),
    ('subdomain', 'campusdesk.test.notice.test', 'misleading_subdomain', False),
    ('userinfo-qr', 'campusdesk.test@notice.test', 'url_userinfo', True),
    ('reply-to', 'campusdesk.test', 'reply_to_mismatch', False),
]


def generate(output, selected=None):
    cases = [case for case in CASES if selected is None or case[0] == selected]
    if not cases:
        raise ValueError('unknown simulation case')
    output.mkdir(parents=True, exist_ok=False)
    manifest = []
    for name, authority, expected, use_qr in cases:
        url = f'https://{authority}/training'
        message = EmailMessage(policy=SMTP)
        message['From'] = 'Campus Desk Training <training@campusdesk.test>'
        message['To'] = 'Lab Recipient <student@example.test>'
        message['Subject'] = f'[SIMULATION] Campus Desk training sample {name}'
        if name == 'reply-to':
            message['Reply-To'] = 'training@notice.test'
        message.set_content('Synthetic lab message. Inspect the attachment offline.\n' if use_qr
                            else f'Synthetic lab message. Inspect this example offline.\n\n{url}\n')
        row = {'case': name, 'email': f'{name}.eml', 'expected': expected}
        if use_qr:
            buffer = BytesIO()
            qrcode.make(url).save(buffer, format='PNG')
            png = buffer.getvalue()
            row['image'] = f'{name}.png'
            (output / row['image']).write_bytes(png)
            message.add_attachment(png, maintype='image', subtype='png', filename=row['image'])
        (output / row['email']).write_bytes(message.as_bytes())
        manifest.append(row)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new directory for fixtures')
    args = parser.parse_args()
    try:
        cases = generate(args.output)
    except OSError as error:
        parser.exit(2, f'error: {error}\n')
    print(f'Created {len(cases)} lab cases in {args.output}')
