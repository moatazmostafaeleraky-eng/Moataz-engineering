# إنشاء ملف RoboDK `.robot` من أجزاء STEP

## ما تنفذه الميزة

تقبل الواجهة سبعة ملفات STEP منفصلة: القاعدة ثم رابط مستقل لكل مفصل من J1 إلى J6. يربط المستخدم الملفات يدويًا ويقدم قيم آلية RoboDK ذات المحاور الستة، ووضع home، واتجاه كل محور، والحدين الأدنى والأعلى. يفترض المُنشئ أن الأجزاء السبعة موضوعة في Assembly واحد عند وضع home الذي أدخله المستخدم.

إذا أمكن استيراد واجهة RoboDK Python والتواصل مع RoboDK، يستورد التطبيق العناصر السبعة، ينشئ آلية `MAKE_ROBOT_6DOF` من خلال `BuildMechanism`، ثم يحفظ عنصر الروبوت بصيغة `.robot` عبر API. في غير ذلك، يحتوي ZIP على ملفات STEP و`config.json` وماكرو `build_in_robodk.py` لتشغيل البناء داخل RoboDK.

يحتوي ZIP على `COPYRIGHT.txt` وملف README. نسبة الملكية `Designed by: Moataz Mostafa` جزء ثابت من الحزمة، ولا تُزال عند إنشاء الملف.

## لماذا نطلب بيانات منفصلة

ملف STEP يوفر الهندسة، لكنه لا يحدد بصورة موثوقة أي الأجسام يتحرك مع كل مفصل، أو محاور الدوران، أو وضع الصفر، أو حدود المفاصل. دليل RoboDK لإنشاء الروبوت يطلب ملفات 3D ودليل/ورقة بيانات الروبوت، ثم اختيار القاعدة وجسم لكل مفصل وإدخال الأبعاد؛ ويذكر الحقول `Home (deg)` و`Minimum limit (deg)` و`Maximum limit (deg)`. لذلك لا يستنتج التطبيق هذه القيم من الشكل الهندسي.

واجهة RoboDK Python توثق `BuildMechanism` لإنشاء آلية، مع قائمة الأجسام ومعاملات الأبعاد ووضع البناء ووضع home واتجاهات المفاصل وحدودها. توثق أيضًا إضافة STEP عبر `AddFile` وحفظ عنصر روبوت قائم بصيغة `.robot` عبر `Item.Save`. يستعمل التطبيق هذه الواجهة، ولا يكتب أو يقلد تنسيق RoboDK الثنائي بنفسه.

## قيود النسخة

- المطلوب سبعة ملفات STEP منفصلة ومميزة. ملف Assembly واحد غير مفصول لا يكفي لتحديد توزيع الأجسام على الوصلات؛ افصل الوصلات في CAD أولًا.
- يجب أن تكون الأجزاء محاذاة في وضع home؛ هذا الوضع يستخدم أيضًا كحالة بناء geometry في API.
- حقل معاملات RoboDK هو 13 قيمة بالترتيب الذي يتوقعه مُنشئ RoboDK ذي الستة محاور. لا يُعامل كجدول DH عام؛ راجع قيم الروبوت في RoboDK أو بياناته قبل الإرسال.
- يجب اختبار الجوانب الحركية في RoboDK بتحريك كل مفصل منفردًا، وفحص اتجاهه ومداه وموضع الصفر. الملف الناتج لا يمثل اعتمادًا للتصنيع أو السلامة أو الدقة.
- إذا لم تتصل نسخة التطبيق بـRoboDK، شغّل `build_in_robodk.py` من ماكرو RoboDK بعد استخراج ZIP. سيتم حفظ `.robot` الناتج بجانب الماكرو.

## مراجع RoboDK الرسمية

- [Create a Mechanism or a Robot](https://robodk.com/doc/en/General-Create-Mechanism-Robot.html) — فصل عناصر القاعدة والمفاصل، بيانات الروبوت، وحدود الحركة.
- [RoboDK Python API](https://robodk.com/doc/en/PythonAPI/robodk.html) — `AddFile`, `BuildMechanism`, و`Item.Save`.
- [Import 3D objects](https://robodk.com/doc/en/Getting-Started-Import-3D-objects.html) — استيراد STEP/STP كأجسام CAD.
- [RoboDK Academy: 3D Model Importation](https://www.youtube.com/watch?v=_g7mhKMlAIo) — عرض عملي لاستيراد نماذج STEP؛ يوضح الاستيراد الهندسي وليس إنشاء المفاصل.
- [RoboDK: Model your Robot Arm](https://www.youtube.com/watch?v=-woD7T27hGQ) — بناء ذراع ستة محاور من أجزاء CAD وبيانات الشركة المصنّعة.
