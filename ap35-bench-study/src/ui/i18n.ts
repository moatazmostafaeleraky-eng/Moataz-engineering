/**
 * English technical labels plus an Egyptian-Arabic explanation layer.
 * Only explanations / narration are translated; diagrams keep their physical
 * orientation and technical labels in both languages.
 */
export type Lang = 'en' | 'ar';

export const NARRATION_AR: Record<string, string> = {
  off: 'الجهاز مقفول، والريش مقفولة.',
  stopping: 'بيقفل: الكباس وقف، والريش بتقفل، ومروحة الخارجي هتفضل شغالة 15 ثانية.',
  startDelay: 'مستني تأخير الـ 3 دقايق قبل ما الكباس يشتغل تاني، علشان يحمي الكباس.',
  starting: 'بيبدأ: الريش بتفتح، ومروحة الخارجي بتشتغل قبل الكباس بـ 5 ثواني.',
  defrost: 'إذابة ثلج: الصمام الرباعي بيبعت الغاز السخن للملف الخارجي علشان يدوّب الثلج، والمراوح واقفة.',
  frostStop: 'حماية تجمّد الملف وقّفت الكباس، والمروحة الداخلية شغالة لحد ما الملف يدفى.',
  tdStop: 'حرارة طرد الكباس عالية زيادة: الكباس وقف لحد ما تنزل لـ 100 درجة.',
  hpStop: 'حماية الضغط العالي وقّفت الكباس.',
  prot: 'فيه حماية شغالة وموقفة الكباس.',
  filterFrost: 'الفلتر المسدود قلّل الهوا، فالملف برد زيادة، وحماية التجمّد بتحدّ من سرعة الكباس.',
  limit: 'فيه حماية أو حد تشغيل بيقلل سرعة الكباس عن المطلوب.',
  fan: 'وضع المروحة: الكباس ومروحة الخارجي واقفين، والمروحة الداخلية بس بتحرّك هوا الأوضة.',
  thermoOff: 'الأوضة وصلت للدرجة المطلوبة، فالكباس وقف (Thermo-OFF) والمروحة على سرعة واطية جدًا.',
  dry: 'وضع التجفيف: الكباس على سرعة قليلة والهوا قليل علشان يشيل الرطوبة من غير ما يبرّد الأوضة زيادة.',
  pulldown: 'الأوضة لسه بعيدة عن الدرجة المطلوبة، فالكباس شغال بسرعة عالية.',
  approach: 'الكباس قلل سرعته لأن حرارة الأوضة قربت من الدرجة المطلوبة.',
  modulate: 'قريب من الدرجة المطلوبة: الكباس شغال بسرعة قليلة على قد حِمل الأوضة.',
  fault: 'فيه عطل: الجهاز وقف بأمان. شيل سبب العطل، وبعدين اقفل الجهاز وافتحه علشان يرجع.',
};

export const TOUR = [
  {
    id: 'heatIn', title: '1. Room heat enters the indoor coil', titleAr: 'حرارة الأوضة بتدخل الملف الداخلي',
    text: 'Warm room air is drawn in through the top grille and filters. Passing the cold fins it gives up sensible heat and, below its dew point, moisture.',
    textAr: 'هوا الأوضة السخن بيدخل من الشبكة اللي فوق والفلاتر، ولما يعدّي على الريش الباردة بيسيب حرارته، ولو برد تحت نقطة الندى بيسيب الرطوبة كمان.',
    part: 'in.coil', mode: 'cutaway' as const,
  },
  {
    id: 'refAbsorb', title: '2. Refrigerant absorbs it', titleAr: 'الفريون بيمتص الحرارة',
    text: 'Inside the tubes R32 boils at the evaporating temperature. The heat it absorbs is m_ref x (h1 - h4), the same number the indoor air loses at steady state.',
    textAr: 'جوه المواسير الـ R32 بيغلي عند درجة التبخير، والحرارة اللي بياخدها بتساوي اللي الهوا خسره لما الدنيا تستقر.',
    part: 'pipe.inCoil', mode: 'cycle' as const,
  },
  {
    id: 'compress', title: '3. The compressor raises the pressure', titleAr: 'الكباس بيرفع الضغط',
    text: 'The inverter drives the KVB073 compressor. More frequency means more refrigerant flow, more capacity and a non-linear rise in input power.',
    textAr: 'الإنفرتر بيشغّل الكباس، وكل ما التردد يزيد، الفريون اللي بيلف يزيد والقدرة تزيد، والكهربا تزيد بشكل مش خطي.',
    part: 'out.compressor', mode: 'outdoor' as const,
  },
  {
    id: 'reject', title: '4. The outdoor coil rejects the heat', titleAr: 'الملف الخارجي بيطرد الحرارة',
    text: 'Hot gas condenses in the L-shaped outdoor coil. The heat rejected equals the heat absorbed plus the compressor work: Qcond = Qevap + Wref.',
    textAr: 'الغاز السخن بيتكثّف في الملف الخارجي، والحرارة اللي بتطلع = اللي اتسحبت من الأوضة + شغل الكباس.',
    part: 'out.coil', mode: 'outdoor' as const,
  },
  {
    id: 'control', title: '5. The controller reduces demand near target', titleAr: 'الكنترول بيقلل الطلب لما نقرب من المطلوب',
    text: 'As the room approaches the set temperature, the PI request falls, the compressor slows down and the unit balances the room load. If even minimum speed is too much, it cycles with the 3-minute restart delay.',
    textAr: 'لما الأوضة تقرب من الدرجة المطلوبة الكنترول بيقلل سرعة الكباس، ولو حتى أقل سرعة كتير على الحِمل، بيفصل ويشتغل مع تأخير الـ 3 دقايق.',
    part: 'in.electrical', mode: 'system' as const,
  },
];

export const FOLLOW_AIR = [
  { part: 'in.inlet', text: 'Room air enters the top inlet at room temperature.', textAr: 'هوا الأوضة بيدخل من فوق بدرجة حرارة الأوضة.' },
  { part: 'in.filterL', text: 'Filters: resistance adds to the fan system curve.', textAr: 'الفلاتر: بتزوّد مقاومة الهوا.' },
  { part: 'in.coil', text: 'Coil: temperature and humidity fall (cooling).', textAr: 'الملف: الحرارة والرطوبة بتقل في التبريد.' },
  { part: 'in.fan', text: 'Cross-flow fan: adds pressure rise and a little fan heat.', textAr: 'المروحة العرضية: بتدفع الهوا وبتزوّد حرارة بسيطة.' },
  { part: 'in.vaneUpper', text: 'Vanes set the jet direction; the outlet area sets the discharge velocity.', textAr: 'الريش بتحدد اتجاه الهوا، ومساحة المخرج بتحدد سرعته.' },
];
export const FOLLOW_REF = [
  { part: 'out.compressor', text: '2: compressor discharge, superheated vapour at high pressure.', textAr: 'خروج الكباس: غاز سخن ضغط عالي.' },
  { part: 'out.fourWay', text: '4-way valve routes the hot gas (to the outdoor coil in COOL).', textAr: 'الصمام الرباعي بيوجّه الغاز السخن.' },
  { part: 'out.coil', text: 'Condenser: heat rejected, vapour becomes liquid. 3: subcooled liquid.', textAr: 'المكثّف: الغاز بيتحول سائل وبيطلع حرارة.' },
  { part: 'out.lev', text: 'LEV + capillary: pressure drops, 4: two-phase mixture (h4 = h3).', textAr: 'صمام التمدد: الضغط بيقع والفريون بيبقى خليط سائل وغاز.' },
  { part: 'pipe.liqLine', text: 'In COOL the 6.35 mm interconnect carries low-pressure two-phase refrigerant.', textAr: 'في التبريد الماسورة الرفيعة بتشيل خليط ضغط واطي.' },
  { part: 'in.coil', text: 'Evaporator: absorbs room heat. 1: superheated vapour back to the compressor.', textAr: 'المبخّر: بيمتص حرارة الأوضة ويرجع غاز للكباس.' },
];
export const FOLLOW_CTRL = [
  { part: 'in.rt11', text: 'Demand: room thermistor vs set temperature.', textAr: 'الطلب: حساس الأوضة مقارنة بالدرجة المطلوبة.' },
  { part: 'in.electrical', text: 'Actuator request: PI frequency request, fan step and vane angle.', textAr: 'الكنترول بيحسب التردد وسرعة المروحة وزاوية الريش.' },
  { part: 'out.inverter', text: 'Protection arbitration: current, discharge, coil frost and pressure limits cap the request.', textAr: 'الحمايات بتحدّ الطلب: التيار، حرارة الطرد، التجمد، والضغط.' },
  { part: 'out.compressor', text: 'Actual response: ramp-limited frequency and the resulting flow. (Electrical energy flow here is a conceptual illustration, not a switching-level inverter model.)', textAr: 'الاستجابة الفعلية: التردد بيتغير بمعدل محدود.' },
];

export const UI_AR: Record<string, string> = {
  independent: 'دراسة مستقلة مبنية على مستندات Mitsubishi Electric المنشورة؛ الأجزاء الداخلية والديناميكا الغير مؤكدة متنمذجة.',
  cfd: 'نموذج تقريبي لحركة الهوا، مش تحقق CFD.',
};
