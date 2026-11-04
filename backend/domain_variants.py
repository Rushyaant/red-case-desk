"""Generate offline, single-edit domain candidates for defensive review."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
from unicodedata import normalize


LABEL = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?')
SUFFIX = re.compile(r'[a-z]{2,63}')
KEYBOARD_ROWS = ('1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm')
# Offsets are in quarter-key widths to model the stagger between rows.
KEYBOARD_POSITIONS = {
    key: (row, offset + 4 * column)
    for row, (keys, offset) in enumerate(zip(KEYBOARD_ROWS, (0, 2, 3, 5)))
    for column, key in enumerate(keys)
}
KEYBOARD_NEIGHBORS = {
    key: tuple(neighbor for neighbor, (other_row, other_column) in KEYBOARD_POSITIONS.items()
               if neighbor != key and abs(row - other_row) <= 1 and abs(column - other_column) <= 4)
    for key, (row, column) in KEYBOARD_POSITIONS.items()
}


def read_confusables(path):
    mappings = {}
    with path.open(encoding='utf-8-sig') as stream:
        for number, line in enumerate(stream, 1):
            data = line.partition('#')[0].strip()
            if not data:
                continue
            try:
                source, target, kind = data.split(';')
                if kind.strip() != 'MA':
                    raise ValueError('expected an MA mapping')
                mappings[chr(int(source, 16))] = ''.join(chr(int(code, 16)) for code in target.split())
            except (ValueError, OverflowError) as error:
                raise ValueError(f'{path}:{number}: invalid Unicode confusables entry') from error
    if not mappings:
        raise ValueError(f'{path}: no Unicode confusables found')
    return mappings


def unicode_variants(name, path):
    try:
        import idna
    except ImportError as error:
        raise ValueError('Unicode lookalikes require the idna package') from error

    mappings = read_confusables(path)

    def skeleton(text):
        return normalize('NFD', ''.join(mappings.get(char, char) for char in normalize('NFD', text)))

    lookalikes = defaultdict(list)
    for character in mappings:
        if not character.isascii():
            lookalikes[skeleton(character)].append(character)

    original_skeleton = skeleton(name)
    for index, character in enumerate(name):
        for replacement in lookalikes[skeleton(character)]:
            visual = normalize('NFC', name[:index] + replacement + name[index + 1:])
            if skeleton(visual) != original_skeleton:
                continue
            try:
                ascii_label = idna.alabel(visual).decode('ascii')
            except idna.IDNAError:
                continue
            if ascii_label.startswith('xn--'):
                yield ascii_label, visual


def generate_variants(domain, *, tlds=(), confusables=None):
    """Return deduplicated candidates and the techniques that produce each."""
    domain = domain.strip().removesuffix('.')
    labels = domain.lower().split('.')
    if (not domain.isascii() or len(labels) != 2 or not LABEL.fullmatch(labels[0])
            or not SUFFIX.fullmatch(labels[1]) or labels[0].startswith('xn--')):
        raise ValueError('enter a two-label ASCII domain, such as campusdesk.test')

    name, suffix = labels
    variants = defaultdict(set)

    def add(candidate, technique):
        if candidate != name and LABEL.fullmatch(candidate) and not candidate.startswith('xn--'):
            variants[f'{candidate}.{suffix}'].add(technique)

    for index, character in enumerate(name):
        before, after = name[:index], name[index + 1:]
        add(before + after, 'omission')
        add(before + character * 2 + after, 'repetition')
        if after:
            add(before + after[0] + character + after[1:], 'adjacent_swap')
            add(before + character + '-' + after, 'hyphen_insertion')
        for neighbor in KEYBOARD_NEIGHBORS.get(character, ()):
            add(before + neighbor + after, 'keyboard_neighbor')
        for bit in range(7):
            replacement = chr(ord(character) ^ (1 << bit))
            add(before + replacement + after, 'bit_flip')

    for tld in tlds:
        tld = tld.removeprefix('.')
        if not tld.isascii() or not SUFFIX.fullmatch(tld.lower()):
            raise ValueError(f'invalid TLD {tld!r}: enter a single ASCII suffix, such as org')
        if tld.lower() != suffix:
            variants[f'{name}.{tld.lower()}'].add('tld_swap')

    display_names = {}
    if confusables is not None:
        for ascii_label, visual_label in unicode_variants(name, confusables):
            candidate = f'{ascii_label}.{suffix}'
            variants[candidate].add('unicode_lookalike')
            display_names[candidate] = f'{visual_label}.{suffix}'

    rows = []
    for candidate, techniques in sorted(variants.items()):
        row = {'domain': candidate, 'techniques': sorted(techniques)}
        if candidate in display_names:
            row['unicode_domain'] = display_names[candidate]
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('domain', help='base domain, such as campusdesk.test')
    parser.add_argument('--tld', action='append', default=[], help='additional suffix, repeatable')
    parser.add_argument('--confusables', type=Path, help='path to Unicode confusables.txt')
    args = parser.parse_args()
    try:
        variants = generate_variants(args.domain, tlds=args.tld, confusables=args.confusables)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(variants, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
