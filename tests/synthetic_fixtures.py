"""Public synthetic fixtures built with the Python standard library only."""
import struct
import zlib


def png_bytes():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    width, height = 160, 100
    pixels = b''.join(b'\0' + bytes([30, 110, 150]) * width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def encode_pdf(objects):
    output = b'%PDF-1.4\n'
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    start = len(output)
    output += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    output += b''.join(f'{n:010} 00000 n \n'.encode() for n in offsets)
    return output + f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF'.encode()


def pdf_bytes(pages=2, mixed=False, oversized=False):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               ('<< /Type /Pages /Count %d /Kids [%s] >>' % (pages, ' '.join(f'{4+i*2} 0 R' for i in range(pages)))).encode(),
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    image_ref = 4 + pages * 2
    for i in range(pages):
        content = f'BT /F1 26 Tf 50 740 Td (Synthetic PDF page {i+1}) Tj 0 -50 Td /F1 14 Tf (Complete original page for review benchmark.) Tj ET'.encode()
        if mixed:
            content = (b'' if i == 0 else content) + b'\nq 450 0 0 420 60 180 cm /Im0 Do Q\n'
            if i == 2:
                content += b'0.3 w\n' + b''.join(f'{60+n%450} 130 m {70+n%450} 170 l S\n'.encode() for n in range(800))
        box = '0 0 10 1000000' if oversized else '0 0 595 842'
        resources = f'/Font << /F1 3 0 R >>' + (f' /XObject << /Im0 {image_ref} 0 R >>' if mixed else '')
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [{box}] /Resources << {resources} >> /Contents {5+i*2} 0 R >>'.encode(),
                        f'<< /Length {len(content)} >>\nstream\n'.encode() + content + b'\nendstream'])
    if mixed:
        pixels = bytes(v for y in range(180) for x in range(240) for v in (x % 256, y % 256, (x+y) % 256))
        image = zlib.compress(pixels)
        objects.append(f'<< /Type /XObject /Subtype /Image /Width 240 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(image)} >>\nstream\n'.encode() + image + b'\nendstream')
    return encode_pdf(objects)
