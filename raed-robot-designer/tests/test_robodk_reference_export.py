"""Opt-in end-to-end check on a real RoboDK library file (slow: minutes per robot).

Set RAED_ROBODK_SAMPLE to an authorized .robot file, e.g. ABB-IRB-1100-4-0-58.robot.
"""
import os
import zipfile
from pathlib import Path

import pytest

from raedbots.robot_import.robodk_robot import make_import_zip, parse_legacy_qcompress_robot

SAMPLE = os.environ.get('RAED_ROBODK_SAMPLE')


@pytest.mark.skipif(not SAMPLE, reason='set RAED_ROBODK_SAMPLE to a .robot file to run')
def test_every_link_of_a_real_robodk_robot_exports_as_a_validated_solid(tmp_path):
    source = Path(SAMPLE)
    links = len(parse_legacy_qcompress_robot(source)['links'])
    manifest = make_import_zip(source, tmp_path / 'out.zip')
    assert manifest['skipped_links'] == []
    assert manifest['part_count'] == links
    with zipfile.ZipFile(tmp_path / 'out.zip') as archive:
        steps = [n for n in archive.namelist() if n.startswith('Reference_Parts/') and n.endswith('.step')]
        assert len(steps) == links
        assert archive.getinfo('robot-import-report.json').file_size < 1_000_000
