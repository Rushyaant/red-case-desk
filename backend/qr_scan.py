"""Read QR payloads from bounded PNG or JPEG input with the system ZBar library."""

import ctypes as c
from ctypes.util import find_library
from io import BytesIO

from PIL import Image


def decode_qr(data):
    with Image.open(BytesIO(data), formats=['PNG', 'JPEG']) as source:
        width, height = source.size
        if width * height > 4_000_000:
            raise ValueError('image exceeds four million pixels')
        pixels = c.create_string_buffer(source.convert('L').tobytes())

    name = find_library('zbar')
    if not name:
        raise OSError('ZBar shared library missing. On Debian or Parrot install libzbar0.')
    lib = c.CDLL(name)
    pointer = c.c_void_p
    uint = c.c_uint
    ulong = c.c_ulong
    integer = c.c_int
    for function, result, arguments in (
        ('image_scanner_create', pointer, []),
        ('image_scanner_destroy', None, [pointer]),
        ('image_scanner_set_config', integer, [pointer, integer, integer, integer]),
        ('image_create', pointer, []),
        ('image_destroy', None, [pointer]),
        ('image_set_format', None, [pointer, ulong]),
        ('image_set_size', None, [pointer, uint, uint]),
        ('image_set_data', None, [pointer, pointer, ulong, pointer]),
        ('scan_image', integer, [pointer, pointer]),
        ('image_first_symbol', pointer, [pointer]),
        ('symbol_get_data', pointer, [pointer]),
        ('symbol_get_data_length', uint, [pointer]),
        ('symbol_next', pointer, [pointer]),
    ):
        call = getattr(lib, 'zbar_' + function)
        call.restype = result
        call.argtypes = arguments

    scanner = lib.zbar_image_scanner_create()
    image = lib.zbar_image_create()
    try:
        if not scanner or not image:
            raise OSError('ZBar allocation failed')
        enable = 0
        qr_code = 64
        if (lib.zbar_image_scanner_set_config(scanner, 0, enable, 0)
                or lib.zbar_image_scanner_set_config(scanner, qr_code, enable, 1)):
            raise OSError('ZBar QR configuration failed')
        lib.zbar_image_set_format(image, int.from_bytes(b'Y800', 'little'))
        lib.zbar_image_set_size(image, width, height)
        # Python owns pixels and keeps it alive until the ZBar image is destroyed.
        lib.zbar_image_set_data(image, pixels, width * height, None)
        if lib.zbar_scan_image(scanner, image) < 0:
            raise ValueError('ZBar could not scan the image')
        results = []
        symbol = lib.zbar_image_first_symbol(image)
        while symbol:
            size = lib.zbar_symbol_get_data_length(symbol)
            data = lib.zbar_symbol_get_data(symbol)
            results.append(c.string_at(data, size).decode('utf-8', errors='strict'))
            symbol = lib.zbar_symbol_next(symbol)
        return results
    finally:
        if image:
            lib.zbar_image_destroy(image)
        if scanner:
            lib.zbar_image_scanner_destroy(scanner)
