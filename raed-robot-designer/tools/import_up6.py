"""Convert this specific public RoboDK UP6 library mesh, not arbitrary .robot files.

The source is qCompress: a big-endian length followed by zlib. Its legacy
mesh blocks contain triangle vertices (3 float32 + 2 packed normal bytes).
Render normals are recomputed with a crease threshold by the browser.
"""
import hashlib
import json
import math
import argparse
from pathlib import Path
import struct
import zlib

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('source',type=Path,help='Downloaded Yaskawa-Motoman-UP6.robot file')
parser.add_argument('output',type=Path,help='Output up6.json path')
args=parser.parse_args()
source=args.source
raw = source.read_bytes()
data = zlib.decompress(raw[4:])
assert len(data) == struct.unpack('>I', raw[:4])[0] == 122656
header = struct.unpack_from('<4000d', data)
assert header[:4] == (1, 4000, 20, 200)
assert ''.join(chr(int(x)) for x in header[1800:1819]) == 'Yaskawa Motoman UP6'
cursor = 32000

def read(fmt):
    global cursor
    result = struct.unpack_from(fmt, data, cursor)
    cursor += struct.calcsize(fmt)
    return result

assert read('<Q')[0] == 7
links = []
for link_index in range(7):
    surfaces = []
    for _ in range(read('<Q')[0]):
        triangle_count = read('<Q')[0]
        rgba = read('<4f')
        positions = []
        for _ in range(triangle_count * 3):
            positions.extend(round(x / 1000, 7) for x in read('<3f'))
            read('<2B')
        assert all(math.isfinite(x) and abs(x) < 2 for x in positions)
        surfaces.append(dict(color=rgba, positions=positions))
    assert read('<2Q') == (0, 0)  # no curves / point clouds in this asset
    links.append(dict(name=['Base','S axis','L axis','U axis','R axis','B axis','T axis'][link_index], surfaces=surfaces))
assert cursor == len(data)
# Separate painted arm lettering from physical body surfaces for the neutral UI.
assert len(links[4]['surfaces'][0]['positions']) == 196 * 9
links[4]['surfaces'][0]['role'] = 'branding'

result = dict(
    name='Yaskawa Motoman UP6',
    source_url='https://robodk.com/robot/Yaskawa-Motoman/UP6',
    download_url='https://cdn.robodk.com/downloads-library/library-robots/Yaskawa-Motoman-UP6.robot',
    source_sha256=hashlib.sha256(raw).hexdigest(),
    scope='RoboDK library visual reference. Geometric articulation only; not controller-calibrated motion or manufacturing CAD.',
    units='metres',
    payload_kg=header[100], reach_m=header[101]/1000, mass_kg=header[103],
    home=[0,0,0,0,0,0],
    # Modified DH: Rx(alpha) Tx(a) Rz(theta + q) Tz(d).
    # These frames are for the reference meshes only, not the design solver.
    mdh=[dict(alpha=header[i], a=header[i+1]/1000,
              theta=header[i+2], d=header[i+3]/1000) for i in range(200,320,20)],
    limits=[[math.radians(header[600+i]),math.radians(header[620+i])] for i in range(6)],
    links=links,
)
out = args.output
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(f'{sum(len(s["positions"])//9 for l in links for s in l["surfaces"])} triangles; {len(links)} links; {out.stat().st_size} bytes')
