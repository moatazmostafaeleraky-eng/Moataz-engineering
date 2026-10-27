/**
 * Machine-readable source register. Every sourced parameter in the registry
 * cites one of these ids with a page. Documents were downloaded from the
 * official Mitsubishi Electric UK library on 2026-10-27 and inspected
 * visually where tables have merged columns.
 */
export interface SourceDoc {
  id: string;
  title: string;
  docNo: string;
  revision: string;
  url: string;
  covers: string;
  kind: 'official' | 'secondary';
  note?: string;
}

export const SOURCES: Record<string, SourceDoc> = {
  S1: {
    id: 'S1', kind: 'official',
    title: 'MSZ-AP R32 Wall Mounted System Inverter Heat Pump - product information sheet',
    docNo: 'library download 3699', revision: 'effective April 2021',
    url: 'https://library.mitsubishielectric.co.uk/pdf/download_full/3699',
    covers: 'MSZ-AP35VGK / MUZ-AP35VG system data (capacities, power, airflow l/s, sound, dims, charge, pipe limits)',
  },
  S2: {
    id: 'S2', kind: 'official',
    title: 'Indoor unit service manual MSZ-AP25-71VG(K)',
    docNo: 'OBH788', revision: 'Revised edition B (Mar. 2019)',
    url: 'https://library.mitsubishielectric.co.uk/pdf/download_full/3963',
    covers: 'MSZ-AP35VG(K) E1/ET1/EN1/ER1: specification (p.6), refrigerant diagram (p.18), microprocessor control (p.21-28)',
  },
  S3: {
    id: 'S3', kind: 'official',
    title: 'Outdoor unit service manual MUZ-AP25-71VG(H)',
    docNo: 'OBH789', revision: 'Revised edition A (Mar. 2019)',
    url: 'https://library.mitsubishielectric.co.uk/pdf/download_full/3965',
    covers: 'MUZ-AP35VG E1/ET1/E2/ET2/ER2: specification (p.6), refrigerant diagram (p.18), performance curves (p.21-23), performance data (p.29-30), actuator control (p.40), service functions (p.41), troubleshooting (p.47-48)',
  },
  S4: {
    id: 'S4', kind: 'official',
    title: 'Indoor unit parts list MSZ-AP25-71VG(K)', docNo: 'OBB788', revision: 'B',
    url: 'https://library.mitsubishielectric.co.uk/pdf/download_full/3973',
    covers: 'Indoor exploded parts: front panel, 2 air filters, line flow fan, horizontal vane (upper) and (lower), vertical vane, nozzle assembly, drain hose, electrical box',
  },
  S5: {
    id: 'S5', kind: 'official',
    title: 'Outdoor unit parts list MUZ-AP25-71VG', docNo: 'OBB789', revision: 'A',
    url: 'https://library.mitsubishielectric.co.uk/pdf/download_full/3975',
    covers: 'Outdoor exploded parts: compressor KVB073FYXMC with 3-piece rubber mount set, 4-way valve + R.V. coil, expansion valve (LEV) assembly incl. capillary, stop valves, motor support, reactor, cabinet/panels',
  },
  S6: {
    id: 'S6', kind: 'official', title: 'Official document index MSZ-AP35VGK', docNo: 'model search', revision: 'accessed 2026-10-27',
    url: 'https://library.mitsubishielectric.co.uk/pdf/model_search?model_query=MSZ-AP35VGK', covers: 'document list',
  },
  S7: {
    id: 'S7', kind: 'official', title: 'Official document index MUZ-AP35VG', docNo: 'model search', revision: 'accessed 2026-10-27',
    url: 'https://library.mitsubishielectric.co.uk/pdf/model_search?model_query=MUZ-AP35VG&scope=all', covers: 'document list',
  },
  S8: {
    id: 'S8', kind: 'official', title: 'MSZ-AP25-50VG(K) operation manual', docNo: 'JG79Y415L01', revision: 'as published',
    url: 'https://library.mitsubishielectric.co.uk/pdf/download_full/3970',
    covers: 'User-facing remote functions; cross-checked against S2 section 9',
  },
  X1: {
    id: 'X1', kind: 'secondary', title: 'Supplier listing of Mitsubishi KNB073FUVHC rotary compressor (sibling model)', docNo: '-', revision: '-',
    url: 'https://qishanr.en.made-in-china.com/product/jCBQXKEkSsWl/China-Mitsubishi-Compressor-Model-Numbers-Knb073fuvhc.html',
    covers: 'States 7.3 cm3/rev for KNB073 (a different model). Used only as a plausibility cross-check of the calibrated displacement, never as an input.',
    note: 'Not a manufacturer document; not specific to KVB073FYXMC.',
  },
  X2: {
    id: 'X2', kind: 'secondary', title: 'Mitsubishi Electric rotary compressor catalogue (compressor business unit)', docNo: '-', revision: '-',
    url: 'https://www.mitsubishi-les.com/en-de/null-2948.html',
    covers: 'Mitsubishi residential K*/S* compressor families are rolling-piston rotary; KVB073 itself is not tabulated there.',
  },
};

/** Discrepancies found during extraction; shown in the assumptions panel and SOURCE_REGISTER.md. */
export const DISCREPANCIES = [
  {
    id: 'D1',
    field: 'Indoor airflow, heating, High',
    detail:
      'The build brief lists 564 m3/h. Visual inspection of S2 p.6 shows 534 m3/h in the merged MSZ-AP25/35 column; 564 m3/h belongs to the MSZ-AP42 column. S1 lists 148 l/s = 533 m3/h. 534 m3/h is used.',
  },
  {
    id: 'D2',
    field: 'Heating min-max capacity',
    detail: 'S1 (2021 sheet): 4.0 (1.6-4.3) kW. S3 p.6 (OBH789-A): 4.0 (1.3-4.6) kW. Both kept; the reference profile uses S1 for the catalogue range and reports S3 as a discrepancy. Nominal 4.0 kW agrees.',
  },
  {
    id: 'D3',
    field: 'Rated compressor frequency',
    detail:
      'Not stated numerically. Inferred from the S3 p.23 correction curves (factor 1.0) as about 84 Hz cooling and 95 Hz heating (digitised, +/-2 Hz).',
  },
  {
    id: 'D4',
    field: 'Indoor fan power vs fan step',
    detail:
      'S2 p.6 gives 19 W cooling / 26 W heating "measured under rated operating frequency" without naming the fan step. S3 p.21 says airflow is set at MAX for the performance curves. The 19/26 W ratio matches the Super High rpm ratio cubed (970 vs 1070 rpm), so both are taken at Super High. Inference, flagged as calibrated.',
  },
  {
    id: 'D5',
    field: 'Brochure airflow (other regions)',
    detail: 'Some regional retailer listings give 82-223 l/s (cooling). S1 and S2 for the UK E1 variant give 82-190 l/s / 294-684 m3/h. Regional data are not mixed in.',
  },
  {
    id: 'D6',
    field: 'Sensible heat factor at rated cooling',
    detail:
      'S3 p.29-30 implies SHF 0.88 at 27/19 degC, 3.5 kW and 684 m3/h. With that airflow the leaving air would have to be above saturation (about 102 % RH). The coil model keeps the physics and reports SHF about 0.84; the table SHC column is fitted with a reduced weight.',
  },
];
