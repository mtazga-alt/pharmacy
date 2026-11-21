/*
 * ===== إعداد قاعدة البيانات السحابية (اختياري) =====
 *
 * بدون أي تعديل: يعمل التطبيق بقاعدة بيانات محلية داخل المتصفح (IndexedDB)
 * على كل جهاز منفصلاً.
 *
 * لكي تتشارك كل الأجهزة (كمبيوتر الصيدلية + جوالات الصيادلة + المواطنين)
 * نفس قاعدة البيانات: أنشئ مشروع Firebase مجاني وضع بياناته هنا بدلاً من null
 * (راجع ملف README.md خطوة بخطوة)، مثال:
 *
 * window.PHARMA_FIREBASE_CONFIG = {
 *   apiKey: "AIza....",
 *   authDomain: "my-pharmacy.firebaseapp.com",
 *   projectId: "my-pharmacy",
 *   storageBucket: "my-pharmacy.appspot.com",
 *   messagingSenderId: "1234567890",
 *   appId: "1:1234567890:web:abcdef"
 * };
 */
window.PHARMA_FIREBASE_CONFIG = null;
