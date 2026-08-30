/**
 * §11 — three languages, every string through i18n from commit one.
 *
 * Copy discipline (§10): plain verbs, sentence case, no jargon. "Lakshmi is
 * heading toward the highway", never "Geofence violation detected". Buttons
 * name what happens: "Make collar beep", not "Trigger actuator".
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  app: { name: 'PashuGuard' },
  nav: { map: 'Map', animals: 'Animals', alerts: 'Alerts', zones: 'Zones', settings: 'Settings' },
  tab: { home: 'Home', animals: 'Animals', map: 'Map', alerts: 'Alerts', profile: 'Profile' },

  status: { safe: 'Safe', watch: 'Keep an eye', warning: 'Warning', high: 'Urgent', critical: 'Danger' },

  age: {
    just_now: 'Updated just now',
    seconds: 'Updated {{n}} sec ago',
    minutes: 'Updated {{n}} min ago',
    hours: 'Updated {{n}} hr ago',
    days: 'Updated {{n}} days ago',
    never: 'Never reported',
  },

  battery: {
    good: 'Collar charged',
    ok: 'Collar has charge',
    low: 'Collar needs charging',
    critical: 'Collar almost dead',
    unknown: 'Collar charge unknown',
  },

  distance: { m: '{{n}} m', km: '{{n}} km' },

  ttr: {
    not_approaching: 'Not heading toward the road',
    under_a_minute: 'Could reach the road in under a minute',
    minutes: 'About {{n}} minutes from the road',
  },

  probability: {
    unlikely: 'Unlikely to reach {{road}} in the next 5 minutes',
    possible: 'Could reach {{road}} within 5 minutes',
    likely: 'Likely to reach {{road}} within 5 minutes',
    very_likely: 'Very likely to reach {{road}} within 5 minutes',
  },

  road: { generic: 'the road' },

  alert: {
    approaching_road: '{{name}} is heading toward {{road}}',
    on_road: '{{name}} is on {{road}}',
    stationary_on_road: '{{name}} is standing on {{road}}',
    outside_zone: '{{name}} has left the grazing area',
    fall: '{{name}} may have fallen',
    gps_fault: "{{name}}'s collar cannot see the sky",
    low_battery: "{{name}}'s collar needs charging",
    offline: "{{name}}'s collar has stopped reporting",
  },

  map: {
    counts: '{{safe}} safe · {{out}} out · {{danger}} danger',
    satellite: 'Satellite',
    plain: 'Plain map',
    refresh: 'Refresh',
    offline: 'You are offline. Showing last known positions.',
    fallback_traffic: 'Traffic data unavailable — using time-of-day estimate',
  },

  animal: {
    see_live: 'See live',
    make_beep: 'Make collar beep',
    call_helper: 'Call helper',
    speed: 'Speed',
    last_update: 'Last update',
  },

  danger: {
    collar_alarm_on: 'Collar alarm: ON', dismiss: 'Close this',
    see_her_live: 'See her live',
    call_for_help: 'Call for help',
    distance_to_road: 'Distance to road',
    traffic_now: 'Traffic now',
    traffic_fast: 'Fast moving traffic',
    traffic_slow: 'Slow, heavy traffic',
  },

  public: {
    found_title: 'This animal has an owner',
    call_owner: 'Call owner',
    injured: 'This animal is injured',
    unknown: 'This tag is not registered',
    contact_authority: 'Contact animal welfare',
    tag: 'Tag number',
    owner: 'Owner',
    village: 'Village',
    loading: 'Loading…',
  },

  zone: {
    polygon: 'Corners', walk: 'Walk the edge',
    radius: 'Radius', area: 'Area', acres: '{{n}} acres',
    walking: 'Walking the boundary…', distance_walked: 'Walked {{n}} m',
    undo: 'Undo', save: 'Save area', close_hint: 'Walk back to the start to finish',
  },

  simulated: 'Simulated data',
};

/**
 * Hindi and Kannada. Translated for meaning, not word-for-word: "Collar needs
 * charging" must read as an instruction in every language, not as a metric.
 */
const hi: typeof en = {
  app: { name: 'पशुगार्ड' },
  nav: { map: 'नक्शा', animals: 'पशु', alerts: 'चेतावनी', zones: 'क्षेत्र', settings: 'सेटिंग' },
  tab: { home: 'होम', animals: 'पशु', map: 'नक्शा', alerts: 'चेतावनी', profile: 'प्रोफ़ाइल' },
  status: { safe: 'सुरक्षित', watch: 'ध्यान रखें', warning: 'चेतावनी', high: 'ज़रूरी', critical: 'खतरा' },
  age: {
    just_now: 'अभी अपडेट हुआ', seconds: '{{n}} सेकंड पहले', minutes: '{{n}} मिनट पहले',
    hours: '{{n}} घंटे पहले', days: '{{n}} दिन पहले', never: 'कभी रिपोर्ट नहीं किया',
  },
  battery: {
    good: 'कॉलर चार्ज है', ok: 'कॉलर में चार्ज है', low: 'कॉलर चार्ज करना है',
    critical: 'कॉलर लगभग बंद', unknown: 'कॉलर चार्ज पता नहीं',
  },
  distance: { m: '{{n}} मी', km: '{{n}} किमी' },
  ttr: {
    not_approaching: 'सड़क की ओर नहीं जा रही',
    under_a_minute: 'एक मिनट से कम में सड़क तक पहुँच सकती है',
    minutes: 'सड़क से लगभग {{n}} मिनट दूर',
  },
  probability: {
    unlikely: 'अगले 5 मिनट में {{road}} तक पहुँचने की संभावना कम है',
    possible: '5 मिनट में {{road}} तक पहुँच सकती है',
    likely: '5 मिनट में {{road}} तक पहुँचने की संभावना है',
    very_likely: '5 मिनट में {{road}} तक पहुँचने की पूरी संभावना है',
  },
  road: { generic: 'सड़क' },
  alert: {
    approaching_road: '{{name}} {{road}} की ओर जा रही है',
    on_road: '{{name}} {{road}} पर है',
    stationary_on_road: '{{name}} {{road}} पर खड़ी है',
    outside_zone: '{{name}} चरागाह से बाहर चली गई है',
    fall: '{{name}} गिर गई हो सकती है',
    gps_fault: '{{name}} का कॉलर आसमान नहीं देख पा रहा',
    low_battery: '{{name}} का कॉलर चार्ज करना है',
    offline: '{{name}} का कॉलर रिपोर्ट नहीं कर रहा',
  },
  map: {
    counts: '{{safe}} सुरक्षित · {{out}} बाहर · {{danger}} खतरा',
    satellite: 'सैटेलाइट', plain: 'सादा नक्शा', refresh: 'ताज़ा करें',
    offline: 'आप ऑफ़लाइन हैं। पिछली ज्ञात जगह दिखा रहे हैं।',
    fallback_traffic: 'ट्रैफ़िक डेटा नहीं — समय के आधार पर अनुमान',
  },
  animal: {
    see_live: 'लाइव देखें', make_beep: 'कॉलर बजाएँ', call_helper: 'मदद बुलाएँ',
    speed: 'गति', last_update: 'आखिरी अपडेट',
  },
  danger: {
    collar_alarm_on: 'कॉलर अलार्म: चालू', dismiss: 'बंद करें', see_her_live: 'लाइव देखें',
    call_for_help: 'मदद बुलाएँ', distance_to_road: 'सड़क से दूरी',
    traffic_now: 'अभी ट्रैफ़िक', traffic_fast: 'तेज़ ट्रैफ़िक', traffic_slow: 'धीमा, भारी ट्रैफ़िक',
  },
  public: {
    found_title: 'इस पशु का मालिक है', call_owner: 'मालिक को कॉल करें',
    injured: 'यह पशु घायल है', unknown: 'यह टैग पंजीकृत नहीं है',
    contact_authority: 'पशु कल्याण से संपर्क करें', tag: 'टैग नंबर',
    owner: 'मालिक', village: 'गाँव', loading: 'लोड हो रहा है…',
  },
  zone: {
    polygon: 'कोने', walk: 'किनारे पर चलें',
    radius: 'त्रिज्या', area: 'क्षेत्रफल', acres: '{{n}} एकड़',
    walking: 'सीमा पर चल रहे हैं…', distance_walked: '{{n}} मी चले',
    undo: 'वापस', save: 'क्षेत्र सहेजें', close_hint: 'खत्म करने के लिए शुरुआत पर लौटें',
  },
  simulated: 'नकली डेटा',
};

const kn: typeof en = {
  app: { name: 'ಪಶುಗಾರ್ಡ್' },
  nav: { map: 'ನಕ್ಷೆ', animals: 'ಪ್ರಾಣಿಗಳು', alerts: 'ಎಚ್ಚರಿಕೆ', zones: 'ಪ್ರದೇಶ', settings: 'ಸೆಟ್ಟಿಂಗ್' },
  tab: { home: 'ಮುಖಪುಟ', animals: 'ಪ್ರಾಣಿಗಳು', map: 'ನಕ್ಷೆ', alerts: 'ಎಚ್ಚರಿಕೆ', profile: 'ಪ್ರೊಫೈಲ್' },
  status: { safe: 'ಸುರಕ್ಷಿತ', watch: 'ಗಮನಿಸಿ', warning: 'ಎಚ್ಚರಿಕೆ', high: 'ತುರ್ತು', critical: 'ಅಪಾಯ' },
  age: {
    just_now: 'ಈಗಷ್ಟೇ ನವೀಕರಿಸಲಾಗಿದೆ', seconds: '{{n}} ಸೆಕೆಂಡ್ ಹಿಂದೆ', minutes: '{{n}} ನಿಮಿಷ ಹಿಂದೆ',
    hours: '{{n}} ಗಂಟೆ ಹಿಂದೆ', days: '{{n}} ದಿನ ಹಿಂದೆ', never: 'ಎಂದೂ ವರದಿಯಾಗಿಲ್ಲ',
  },
  battery: {
    good: 'ಕಾಲರ್ ಚಾರ್ಜ್ ಆಗಿದೆ', ok: 'ಕಾಲರ್‌ನಲ್ಲಿ ಚಾರ್ಜ್ ಇದೆ', low: 'ಕಾಲರ್ ಚಾರ್ಜ್ ಮಾಡಬೇಕು',
    critical: 'ಕಾಲರ್ ಬಹುತೇಕ ಖಾಲಿ', unknown: 'ಕಾಲರ್ ಚಾರ್ಜ್ ತಿಳಿದಿಲ್ಲ',
  },
  distance: { m: '{{n}} ಮೀ', km: '{{n}} ಕಿಮೀ' },
  ttr: {
    not_approaching: 'ರಸ್ತೆಯ ಕಡೆಗೆ ಹೋಗುತ್ತಿಲ್ಲ',
    under_a_minute: 'ಒಂದು ನಿಮಿಷದೊಳಗೆ ರಸ್ತೆ ತಲುಪಬಹುದು',
    minutes: 'ರಸ್ತೆಯಿಂದ ಸುಮಾರು {{n}} ನಿಮಿಷ',
  },
  probability: {
    unlikely: 'ಮುಂದಿನ 5 ನಿಮಿಷದಲ್ಲಿ {{road}} ತಲುಪುವ ಸಾಧ್ಯತೆ ಕಡಿಮೆ',
    possible: '5 ನಿಮಿಷದಲ್ಲಿ {{road}} ತಲುಪಬಹುದು',
    likely: '5 ನಿಮಿಷದಲ್ಲಿ {{road}} ತಲುಪುವ ಸಾಧ್ಯತೆ ಇದೆ',
    very_likely: '5 ನಿಮಿಷದಲ್ಲಿ {{road}} ತಲುಪುವ ಸಾಧ್ಯತೆ ಹೆಚ್ಚು',
  },
  road: { generic: 'ರಸ್ತೆ' },
  alert: {
    approaching_road: '{{name}} {{road}} ಕಡೆಗೆ ಹೋಗುತ್ತಿದೆ',
    on_road: '{{name}} {{road}} ಮೇಲಿದೆ',
    stationary_on_road: '{{name}} {{road}} ಮೇಲೆ ನಿಂತಿದೆ',
    outside_zone: '{{name}} ಮೇಯುವ ಪ್ರದೇಶದಿಂದ ಹೊರಗೆ ಹೋಗಿದೆ',
    fall: '{{name}} ಬಿದ್ದಿರಬಹುದು',
    gps_fault: '{{name}} ಕಾಲರ್‌ಗೆ ಆಕಾಶ ಕಾಣುತ್ತಿಲ್ಲ',
    low_battery: '{{name}} ಕಾಲರ್ ಚಾರ್ಜ್ ಮಾಡಬೇಕು',
    offline: '{{name}} ಕಾಲರ್ ವರದಿ ಮಾಡುತ್ತಿಲ್ಲ',
  },
  map: {
    counts: '{{safe}} ಸುರಕ್ಷಿತ · {{out}} ಹೊರಗೆ · {{danger}} ಅಪಾಯ',
    satellite: 'ಉಪಗ್ರಹ', plain: 'ಸಾದಾ ನಕ್ಷೆ', refresh: 'ರಿಫ್ರೆಶ್',
    offline: 'ನೀವು ಆಫ್‌ಲೈನ್. ಕೊನೆಯ ತಿಳಿದ ಸ್ಥಾನ ತೋರಿಸಲಾಗಿದೆ.',
    fallback_traffic: 'ಸಂಚಾರ ಮಾಹಿತಿ ಇಲ್ಲ — ಸಮಯದ ಆಧಾರದ ಅಂದಾಜು',
  },
  animal: {
    see_live: 'ಲೈವ್ ನೋಡಿ', make_beep: 'ಕಾಲರ್ ಬೀಪ್ ಮಾಡಿ', call_helper: 'ಸಹಾಯಕರಿಗೆ ಕರೆ',
    speed: 'ವೇಗ', last_update: 'ಕೊನೆಯ ನವೀಕರಣ',
  },
  danger: {
    collar_alarm_on: 'ಕಾಲರ್ ಅಲಾರಂ: ಆನ್', dismiss: 'ಮುಚ್ಚಿ', see_her_live: 'ಲೈವ್ ನೋಡಿ',
    call_for_help: 'ಸಹಾಯಕ್ಕೆ ಕರೆ ಮಾಡಿ', distance_to_road: 'ರಸ್ತೆಯಿಂದ ದೂರ',
    traffic_now: 'ಈಗ ಸಂಚಾರ', traffic_fast: 'ವೇಗದ ಸಂಚಾರ', traffic_slow: 'ನಿಧಾನ, ದಟ್ಟ ಸಂಚಾರ',
  },
  public: {
    found_title: 'ಈ ಪ್ರಾಣಿಗೆ ಮಾಲೀಕರಿದ್ದಾರೆ', call_owner: 'ಮಾಲೀಕರಿಗೆ ಕರೆ ಮಾಡಿ',
    injured: 'ಈ ಪ್ರಾಣಿ ಗಾಯಗೊಂಡಿದೆ', unknown: 'ಈ ಟ್ಯಾಗ್ ನೋಂದಾಯಿಸಿಲ್ಲ',
    contact_authority: 'ಪ್ರಾಣಿ ಕಲ್ಯಾಣ ಸಂಪರ್ಕಿಸಿ', tag: 'ಟ್ಯಾಗ್ ಸಂಖ್ಯೆ',
    owner: 'ಮಾಲೀಕ', village: 'ಗ್ರಾಮ', loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  },
  zone: {
    polygon: 'ಮೂಲೆಗಳು', walk: 'ಅಂಚಿನಲ್ಲಿ ನಡೆಯಿರಿ',
    radius: 'ತ್ರಿಜ್ಯ', area: 'ವಿಸ್ತೀರ್ಣ', acres: '{{n}} ಎಕರೆ',
    walking: 'ಗಡಿಯಲ್ಲಿ ನಡೆಯುತ್ತಿದ್ದೀರಿ…', distance_walked: '{{n}} ಮೀ ನಡೆದಿದ್ದೀರಿ',
    undo: 'ರದ್ದು', save: 'ಪ್ರದೇಶ ಉಳಿಸಿ', close_hint: 'ಮುಗಿಸಲು ಪ್ರಾರಂಭಕ್ಕೆ ಹಿಂತಿರುಗಿ',
  },
  simulated: 'ಅನುಕರಿಸಿದ ಮಾಹಿತಿ',
};

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    kn: { translation: kn },
  },
  lng: localStorage.getItem('pashuguard.lang') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;

export function setLanguage(lng: 'en' | 'hi' | 'kn') {
  localStorage.setItem('pashuguard.lang', lng);
  void i18n.changeLanguage(lng);
}
