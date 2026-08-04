import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * Message catalogue.
 *
 * All four locales live in one file on purpose: it makes a missing or drifted
 * translation visible by reading down the page, and `Record<Locale, Messages>`
 * makes it a type error to forget one entirely.
 *
 * `Messages` is derived from the English catalogue, so adding an English key and
 * not translating it fails the build rather than silently shipping English inside a
 * French page.
 *
 * Currently wired into the pages a mail client opens — unsubscribe and subscribe
 * confirmation — which is where a non-English reader arrives first and has the
 * least context. The signed-in app is still English; the keys for it are not
 * invented here in advance, because unused translations rot.
 */

const en = {
  "brand.tagline": "Weekly show digest",

  "unsubscribe.confirm.title": "Stop the weekly email?",
  "unsubscribe.confirm.body":
    "One click and the Friday digest stops. Your account, cities, genres and feeds all stay as they are.",
  "unsubscribe.confirm.action": "Unsubscribe",
  "unsubscribe.done.title": "Unsubscribed",
  "unsubscribe.done.body":
    "You won't get the weekly email any more. Your account and everything you've followed are untouched — you can turn the digest back on from Settings whenever you like.",
  "unsubscribe.done.link": "Open settings",

  "subscribe.confirm.title": "Confirm your weekly digest",
  "subscribe.confirm.body":
    "One click and the Friday email starts. You can change what it covers, or stop it entirely, at any time.",
  "subscribe.confirm.action": "Yes, subscribe me",
  "subscribe.done.title": "You're subscribed",
  "subscribe.done.body":
    "The first digest goes out on Friday morning. To change cities or genres, add your listening history, or stop it, enter this same address and we'll email you a link — there is no password.",
  "subscribe.done.link": "Fine-tune what it covers",
  "subscribe.expired.title": "That link has expired",
  "subscribe.expired.body":
    "Confirmation links last seven days. Ask for a new one from the home page and it will arrive in a moment.",

  "link.invalid.title": "That link isn't valid",
  "link.invalid.body":
    "It may have already been used, or it was truncated by your mail client.",
  "error.generic.title": "Something went wrong",
  "error.generic.body": "Please try again in a moment.",

  "common.privacy": "Privacy",
  "common.home": "Back to likelylist",
  "common.signIn": "Sign in",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const es: Messages = {
  "brand.tagline": "Resumen semanal de conciertos",

  "unsubscribe.confirm.title": "¿Cancelar el correo semanal?",
  "unsubscribe.confirm.body":
    "Un clic y el resumen del viernes se detiene. Tu cuenta, ciudades, géneros y capturas se quedan como están.",
  "unsubscribe.confirm.action": "Cancelar suscripción",
  "unsubscribe.done.title": "Suscripción cancelada",
  "unsubscribe.done.body":
    "Ya no recibirás el correo semanal. Tu cuenta y todo lo que sigues quedan intactos: puedes reactivar el resumen desde Ajustes cuando quieras.",
  "unsubscribe.done.link": "Abrir ajustes",

  "subscribe.confirm.title": "Confirma tu resumen semanal",
  "subscribe.confirm.body":
    "Un clic y empieza el correo del viernes. Puedes cambiar lo que incluye, o detenerlo del todo, en cualquier momento.",
  "subscribe.confirm.action": "Sí, suscríbeme",
  "subscribe.done.title": "Ya estás suscrito",
  "subscribe.done.body":
    "El primer resumen sale el viernes por la mañana. Para cambiar ciudades o géneros, añadir tu historial de escucha, o detenerlo, introduce esta misma dirección y te enviaremos un enlace por correo — no hay contraseña.",
  "subscribe.done.link": "Ajusta lo que incluye",
  "subscribe.expired.title": "Este enlace ha caducado",
  "subscribe.expired.body":
    "Los enlaces de confirmación duran siete días. Pide uno nuevo desde la página de inicio y llegará en un momento.",

  "link.invalid.title": "Este enlace no es válido",
  "link.invalid.body":
    "Puede que ya se haya usado, o que tu cliente de correo lo haya cortado.",
  "error.generic.title": "Algo ha ido mal",
  "error.generic.body": "Inténtalo de nuevo en un momento.",

  "common.privacy": "Privacidad",
  "common.home": "Volver a likelylist",
  "common.signIn": "Iniciar sesión",
};

const fr: Messages = {
  "brand.tagline": "Sélection hebdomadaire de concerts",

  "unsubscribe.confirm.title": "Arrêter l'e-mail hebdomadaire ?",
  "unsubscribe.confirm.body":
    "Un clic et la sélection du vendredi s'arrête. Votre compte, vos villes, vos genres et vos captures restent inchangés.",
  "unsubscribe.confirm.action": "Se désabonner",
  "unsubscribe.done.title": "Désabonnement effectué",
  "unsubscribe.done.body":
    "Vous ne recevrez plus l'e-mail hebdomadaire. Votre compte et tout ce que vous suivez restent intacts — vous pouvez réactiver la sélection depuis les Paramètres quand vous voulez.",
  "unsubscribe.done.link": "Ouvrir les paramètres",

  "subscribe.confirm.title": "Confirmez votre sélection hebdomadaire",
  "subscribe.confirm.body":
    "Un clic et l'e-mail du vendredi commence. Vous pouvez modifier son contenu, ou l'arrêter complètement, à tout moment.",
  "subscribe.confirm.action": "Oui, abonnez-moi",
  "subscribe.done.title": "Vous êtes abonné",
  "subscribe.done.body":
    "La première sélection part vendredi matin. Pour changer de villes ou de genres, ajouter votre historique d'écoute, ou l'arrêter, saisissez cette même adresse et nous vous enverrons un lien par e-mail — il n'y a pas de mot de passe.",
  "subscribe.done.link": "Ajuster ce qu'elle couvre",
  "subscribe.expired.title": "Ce lien a expiré",
  "subscribe.expired.body":
    "Les liens de confirmation sont valables sept jours. Demandez-en un nouveau depuis la page d'accueil, il arrivera dans un instant.",

  "link.invalid.title": "Ce lien n'est pas valide",
  "link.invalid.body":
    "Il a peut-être déjà été utilisé, ou votre logiciel de messagerie l'a tronqué.",
  "error.generic.title": "Une erreur s'est produite",
  "error.generic.body": "Merci de réessayer dans un instant.",

  "common.privacy": "Confidentialité",
  "common.home": "Retour à likelylist",
  "common.signIn": "Se connecter",
};

const zhHant: Messages = {
  "brand.tagline": "每週演出精選",

  "unsubscribe.confirm.title": "要停止每週電子報嗎？",
  "unsubscribe.confirm.body":
    "點一下，週五的演出精選就會停止。你的帳號、城市、樂風與已上傳的截圖都會保持原狀。",
  "unsubscribe.confirm.action": "取消訂閱",
  "unsubscribe.done.title": "已取消訂閱",
  "unsubscribe.done.body":
    "你不會再收到每週電子報。帳號與所有追蹤的內容都沒有變動 —— 隨時可以在「設定」裡重新開啟。",
  "unsubscribe.done.link": "開啟設定",

  "subscribe.confirm.title": "確認訂閱每週演出精選",
  "subscribe.confirm.body":
    "點一下，週五的電子報就會開始。你隨時可以更改內容，或完全停止。",
  "subscribe.confirm.action": "是，訂閱我",
  "subscribe.done.title": "訂閱完成",
  "subscribe.done.body":
    "第一封精選會在週五早上寄出。想更改城市或樂風、加入你的聽歌紀錄，或停止訂閱，輸入同一個信箱，我們會寄一個連結給你——沒有密碼。",
  "subscribe.done.link": "調整精選內容",
  "subscribe.expired.title": "這個連結已過期",
  "subscribe.expired.body":
    "確認連結的有效期是七天。回首頁重新索取一封，馬上就會寄到。",

  "link.invalid.title": "這個連結無效",
  "link.invalid.body": "可能已經被使用過，或是被你的郵件程式截斷了。",
  "error.generic.title": "出了點問題",
  "error.generic.body": "請稍後再試一次。",

  "common.privacy": "隱私權",
  "common.home": "回到 likelylist",
  "common.signIn": "登入",
};

const CATALOGUES: Record<Locale, Messages> = {
  en,
  es,
  fr,
  "zh-Hant": zhHant,
};

export type Translate = (key: MessageKey) => string;

/**
 * A lookup function for one locale.
 *
 * Falls back to English per key rather than per locale, so a single missing string
 * degrades to English instead of dropping the reader out of their language
 * entirely.
 */
export function translator(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
  return (key) => catalogue[key] ?? CATALOGUES[DEFAULT_LOCALE][key] ?? key;
}

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
}
