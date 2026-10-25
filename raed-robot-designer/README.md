# RAED Robot Designer

تطبيق محلي لتكوين روبوت 6 محاور وحساب نتائج أولية ومقارنة بدائل وحفظ إصدارات ومراجعتها وتصديرها.

**Designed by: Moataz Mostafa. All rights reserved.** This attribution is part of the application footer and generated export packages; preserve it in future UI and export changes. See [`COPYRIGHT.txt`](COPYRIGHT.txt).

## What's new in 0.3

- **Axis torque sizing** (Actuator Engineering → Axis torque sizing): worst-case static holding torque per axis over a J2 × J3 × J5 posture sweep, reducer vs. motor-limited continuous rating, utilization bars, torque needed at the rated payload, minimum ratio for the selected motor, and the static TCP payload capacity with its limiting axis.
- **Benchmark vs RAED R-1** (Compare & Report): joins the saved design's computed flange/wrist reach and static payload capacity with the RAED R-1 public specification (11 kg, 1.30 m — public listing, unverified) and the Yaskawa UP6 RoboDK reference. A RoboDK `.robot` file inspected in Competitor Benchmark is added to the table automatically.
- **Engineering report PDF** for any calculated revision (Review & CAD export), also bundled in the review ZIP with `actuator-sizing.json` and `benchmark.json`.
- **Quick-start application templates**: RAED R-1 class CNC tending, MIG welding, palletizing/packaging, light pick & place — fill requirements, task poses and the geometry target.
- More applications (machine tending, material handling, palletizing, packaging); geometry optimizer moved beside the 3D view; cleaner mode pages, inline units and a styled file picker.
- `gravity_torques` vectorized (identical results, ~4× faster) and the static load model shared between checks and sizing.

Worked example: [RAED R-1 class CNC machine-tending case study (PDF, Arabic)](docs/case-study/RAED-R1-Case-Study.pdf) with the generated [engineering report](docs/case-study/engineering-report-rev-e7daf6eba8.pdf).

## Four engineering workflows

The interface is organized around the workflows in `instructions.txt`: **New Robot Design** (requirements, primary full 6R geometry optimization, saved revisions and checks), **Competitor Benchmark** (supported RoboDK import, mesh/envelope metrics, available header metadata, modified DH and joint limits), **Actuator Engineering** (catalog evidence, BOM and supported motor/gearbox-pattern comparison), and **Compare & Report** (bounded internal candidate comparison and revision-bound review/CAD export). Existing engineering engines and screens remain available within these modes rather than being deleted.

This navigation refactor does not imply missing engineering functions are complete: competitor files are not yet joined into the automated Pareto ranking; the local component catalogue is not fully validated; encoder and drive data, full actuator sizing, and live Egyptian supplier research are unavailable. These limits are shown in the interface rather than filled with invented data.

**الإصدار 0.2 هو استوديو معاينة ومراجعة هندسية يعمل فعليًا، وليس اكتمالًا لجميع متطلبات الـMVP أو نظامًا معتمدًا للتصنيع.** راجع [سجل التنفيذ](docs/IMPLEMENTATION_STATUS.md).

## التشغيل على هذا الجهاز

من مجلد المشروع في PowerShell:

```powershell
.\.venv\Scripts\python.exe run.py
```

ثم افتح `http://127.0.0.1:8765`. يمكن أيضًا تشغيل `start.ps1`. التطبيق مرتبط بالجهاز المحلي فقط، ولا يحتاج خدمات سحابية أو مفتاح API. أغلق عملية التشغيل لإيقاف الخادم.

## تثبيت نظيف على جهاز آخر

Python 3.11–3.13 وبيئة افتراضية:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

`requirements.txt` يصف مسار التثبيت المعزول مع CadQuery 2.6.1 واعتمادياته المتوافقة. على جهاز التطوير الحالي جرى استخدام مكتبات الحساب وOpenCascade الموجودة بالفعل، مع عزل FastAPI وStarlette والحزم الصغيرة داخل `.venv`. **هذه البيئة ليست مطابقة حرفيًا لملف المتطلبات**؛ الإصدارات المستخدمة مسجلة في `docs/runtime-versions.json`. لا يُعد نجاح اختبارات هذه البيئة إثباتًا لمسار التثبيت النظيف.

CadQuery هو مسار CAD الأساسي. إذا تعذر استيراده بسبب اختلاف نسخة OpenCascade، يستخدم التطبيق محول OpenCascade المباشر لنفس الأشكال البدائية، ويذكر اسم المحرك الفعلي في manifest. على هذا الجهاز استُخدم هذا المحول واختُبر استيراد STEP الناتج والتحقق من الأجسام والأبعاد والحجوم.

## الاستخدام

1. أدخل المتطلبات وحدد معنى الحمولة والأداة والخامة وطريقة التصنيع.
2. احفظ إصدارًا وشغّل الحساب. يمكنك تحريك المفاصل لمعاينة FK وإضافة موضع TCP كنقطة مهمة.
3. عدّل نقاط المهمة بالمتر في إطار العالم، وأضف العوائق. أرضية الخلية Z=0، وحدود X وY حول الأصل.
4. احفظ إصدارًا جديدًا لإعادة حساب التعديلات. عرض المفاصل لا يغيّر نتيجة الإصدار المحفوظ.
5. راجع الفحوص والأدلة. `unknown` لا يُعامل كنجاح، ولا يدخل الحل غير المتحقق في Pareto.
6. قارن حتى 6 بدائل من الواجهة، وافتح الإصدار الذي تريد مراجعته.
7. سجّل اسم المراجع لتحضير حزمة **للمراجعة فقط** ثم نزّل ZIP. موافقة المراجعة لا تمنح اعتماد تصنيع.

يحفظ التطبيق المشاريع في `data/projects/` وحالة الأعمال في `data/jobs/`. متغير `RAEDBOTS_DATA_DIR` يغير مجلد المشاريع، وتُحفظ الوظائف في المجلد المجاور له. الاحتفاظ بنسخة من هذين المجلدين يكفي لنسخ البيانات المحلية احتياطيًا أثناء إيقاف الخادم. لا تعمل بعمليات خادم متعددة على نفس مجلد البيانات.

## إنشاء RoboDK `.robot` من STEP

من **Competitor Benchmark → STEP → RoboDK .robot** ارفع سبعة ملفات STEP منفصلة: القاعدة ووصلة لكل محور J1–J6، واربطها في الواجهة. أدخل معاملات RoboDK ذات الستة محاور ووضع home واتجاهات المحاور والحدود من ورقة بيانات الروبوت. يجب أن تكون الأجزاء موضوعة معًا في وضع home. ملف Assembly واحد غير مفصول لا يكفي لتحديد أي الأجسام تتبع كل مفصل.

إذا كانت واجهة RoboDK Python متاحة من بيئة التطبيق، ينشئها التطبيق ويحفظ `.robot` بواسطة API الرسمي. وإلا تحصل على ZIP يحتوي STEP وماكرو `build_in_robodk.py` تشغله داخل RoboDK. في كلا المسارين تُرفق `COPYRIGHT.txt` في الحزمة. راجع [متطلبات وتفاصيل البناء](docs/ROBDK_STEP_EXPORT.md). راجع اتجاه كل محور وحدوده وحركة الروبوت في RoboDK قبل استخدام الناتج؛ إنه ليس اعتمادًا للتصنيع أو السلامة.

## محتويات التصدير

- أجزاء وتجميع STEP وSTL بوحدة **mm**: وصلات مجوفة مفاهيمية وصفائح وأغلفة مفاصل.
- URDF يطابق ترتيب التحويلات Standard DH واتجاه TCP؛ لا يشمل بيانات ديناميكا مكتملة.
- BOM بصيغة CSV، وتقرير فجوات التوريد المصري HTML، وبيانات JSON.
- لقطة المدخلات والكتالوج والنتائج وقرار المراجعة، وبصمات SHA-256 للملفات في manifest.

هندسة المشتريات الأصلية وثقوب التثبيت والتفاوتات ورسومات التصنيع ليست ضمن هذه الحزمة. نموذج الكتلة التقريبي مستقل عن CAD؛ لا تدّعي الواجهة تطابقهما.

## التحقق

```powershell
New-Item -ItemType Directory -Force tmp | Out-Null
.\.venv\Scripts\python.exe -m pytest -q --basetemp tmp/test-run
```

الاختبارات تغطي FK تحليليًا، جاذبية حمل معروف، خطأ الاتجاه عند 180°، FK/IK، صلاحية البيانات، عزل الإصدارات، منع اعتماد تصنيع غير متحقق، حفظ تقارير وتصدير ZIP، وإعادة استيراد STEP وحجومه، ومطابقة URDF مع DH، وبناء RoboDK عبر API وهمي ومسار الماكرو الاحتياطي وبقاء إشعار الملكية.

اختبار المتصفح في `tests/browser-smoke.cjs` يستخدم Playwright وEdge محليًا. حدّد `PLAYWRIGHT_PATH` لمسار الحزمة عند الحاجة. ينشئ بيانات اختبار؛ استخدم مجلد بيانات منفصلًا عند تشغيله.

توثيق API التفاعلي: `/docs`.

## Solid robot viewer

The studio now includes the original UP6 library mesh with six-axis visual articulation and solid housings for the current design. See [viewer scope and verification](docs/SOLID_VIEWER.md).

