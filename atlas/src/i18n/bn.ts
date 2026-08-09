/**
 * The Bengali (বাংলা) catalogue.
 *
 * Typed as a PARTIAL of the English catalogue on purpose: coverage will lag
 * behind new features for a while, and a half-translated screen with English
 * gaps is far better than a blank one or a screenful of raw keys. `translate`
 * falls back to English per key (see `index.ts`), so a missing entry here is a
 * cosmetic gap, never a broken screen. The parity test in `i18n.test.ts` is what
 * stops that permission from turning into permanent drift.
 *
 * Register: the same one Bengali software localisation has settled on (Bengali
 * Wikipedia, Mozilla bn) — সাধু-influenced formal vocabulary for UI nouns
 * (সংরক্ষণ, সম্পাদনা, অনুসন্ধান, রপ্তানি/আমদানি) with plain conversational
 * phrasing for sentences, and the polite -উন imperative for buttons. Kept SHORT:
 * these sit in the same buttons and chips as the English, so a label that runs
 * to twice the width breaks the layout.
 *
 * Technical terms deliberately left in LATIN script — GPS, PDF, GeoJSON, GPX,
 * JSON, GIS, Markdown, URL, and the product name Meridian. Bengali users read
 * these as-is; transliterating them ("জিওজেসন") makes a file format harder to
 * recognise, not easier, and the whole point of those labels is that you can
 * match them against the file you get. Loanwords that Bengali speakers actually
 * *say* are written in Bengali script (অ্যাপ, ট্যাগ, অডিও, ফিল্টার, সেটিংস,
 * থিম, গ্রাফিক্স) — that's a different case from a format name.
 */
import type { en } from './en';

export const bn: Partial<Record<keyof typeof en, string>> = {
  // ── Navigation & window chrome ──
  'nav.home': 'হোম',
  'nav.timeline': 'সময়রেখা',
  // Formal register, matching সময়রেখা/অনুসন্ধান rather than the loanword
  // "এক্সপ্লোর". Note অন্বেষণ (Explore) and অনুসন্ধান (Search) are close in
  // sense — they never sit side by side (Search is only a heading INSIDE
  // Explore now), but this is one for the native-speaker pass, Known Issue #12.
  'nav.explore': 'অন্বেষণ',
  'nav.trips': 'ভ্রমণ',
  'nav.search': 'অনুসন্ধান',
  'nav.data': 'তথ্য',
  'nav.settings': 'সেটিংস',
  'nav.newEntry': 'নতুন লেখা',
  'nav.hide': 'লুকান',
  'nav.showList': 'তালিকা দেখান',
  'nav.tagline': 'মাঠের দিনলিপি',
  'nav.openSettings': 'সেটিংস খুলুন',

  // ── Capture FAB ──
  'capture.write': 'লিখুন',
  'capture.photo': 'ছবি',
  'capture.voice': 'ভয়েস নোট',
  'capture.label': 'দ্রুত ক্যাপচার',

  // ── Buttons and words that recur everywhere ──
  'common.save': 'সংরক্ষণ',
  'common.cancel': 'বাতিল',
  'common.close': 'বন্ধ',
  'common.delete': 'মুছুন',
  'common.edit': 'সম্পাদনা',
  'common.back': 'পিছনে',
  'common.clear': 'সাফ করুন',
  'common.undo': 'ফিরিয়ে নিন',
  'common.open': 'খুলুন',
  'common.add': 'যোগ করুন',
  'common.done': 'সম্পন্ন',
  'common.retry': 'আবার চেষ্টা করুন',
  'common.yes': 'হ্যাঁ',
  'common.no': 'না',
  'common.on': 'চালু',
  'common.off': 'বন্ধ',
  'common.loading': 'আসছে…',
  'common.saving': 'সংরক্ষণ হচ্ছে…',
  'common.now': 'এখন',
  'common.reset': 'পুনঃস্থাপন',
  // Bengali does not inflect the noun for number, so both forms use লেখা; the
  // classifier টি carries the counting instead.
  'common.oneEntry': 'একটি লেখা',
  'common.nEntries': '{count}টি লেখা',
  'common.onePlace': 'একটি জায়গা',
  'common.nPlaces': '{count}টি জায়গা',

  // ── Welcome screen ──
  'welcome.stillUp': 'এখনও জেগে আছেন',
  'welcome.goodMorning': 'শুভ সকাল',
  'welcome.goodAfternoon': 'শুভ অপরাহ্ণ',
  'welcome.goodEvening': 'শুভ সন্ধ্যা',
  'welcome.greetingWithName': '{greeting}, {name}',
  'welcome.addName': 'নাম যোগ করুন',
  'welcome.editName': 'নাম বদলান',
  'welcome.askName': 'আপনাকে কী নামে ডাকব?',
  'welcome.firstEntry': 'আপনার প্রথম লেখা দিয়েই মানচিত্র শুরু।',
  'welcome.pinned': 'পিন করা',
  'welcome.since': '{month} থেকে',
  'welcome.almanac': 'ভূগোলবিদের পঞ্জিকা',
  'welcome.anotherFact': 'আরেকটি তথ্য দেখান',
  'welcome.holidays': 'ছুটি ও উৎসব',
  'welcome.poi': 'কাছের দর্শনীয় স্থান',
  'welcome.todaysFocus': 'আজকের বিষয়',
  'welcome.onThisDay': 'এই দিনে',
  'welcome.calendar': 'বর্ষপঞ্জি',
  'welcome.findingLocation': 'আপনি কোথায় আছেন, খুঁজছি…',
  'welcome.locationOff': 'অবস্থান বন্ধ — তবু লেখা যাবে',
  'welcome.youAreIn': 'আপনি {place}-এ আছেন',
  'welcome.youAreNear': 'আপনি {coords}-এর কাছে',

  // ── Journal editor ──
  'editor.newEntry': 'নতুন লেখা',
  'editor.editEntry': 'লেখা সম্পাদনা',
  'editor.save': 'লেখা সংরক্ষণ',
  'editor.saveChanges': 'পরিবর্তন সংরক্ষণ',
  'editor.placeholder': 'আপনার লেখা শুরু করুন…',
  'editor.dateTime': 'তারিখ ও সময়',
  'editor.heading': 'শিরোনাম',
  'editor.bold': 'গাঢ়',
  'editor.italic': 'বাঁকা',
  'editor.bulletList': 'তালিকা',
  'editor.quote': 'উদ্ধৃতি',
  'editor.addLink': 'লিঙ্ক যোগ করুন',
  'editor.linkUrl': 'URL',
  'editor.dictate': 'বলে লিখুন',
  'editor.dictationStop': 'বলা থামান',
  'editor.listening': 'শুনছি… বলুন, থামাতে আবার মাইকে চাপ দিন।',
  'editor.dictationBlocked': 'মাইক্রোফোন বন্ধ আছে। ব্রাউজারে এই সাইটের জন্য মাইক চালু করে আবার চেষ্টা করুন।',
  'editor.dictationNoMic': 'এই যন্ত্রে কোনো মাইক্রোফোন পাওয়া যায়নি।',
  'editor.dictationNeedsNetwork': 'বলে লেখার জন্য ইন্টারনেট দরকার — ব্রাউজার কথাটি ক্লাউডে লিখে দেয়।',
  'editor.addImage': 'ছবি যোগ করুন',
  'editor.takePhoto': 'ছবি তুলুন',
  'editor.setLocation': 'অবস্থান দিন',
  'editor.clickTheMap': 'মানচিত্রে চাপ দিন…',
  'editor.gettingLocation': 'অবস্থান নিচ্ছি…',
  'editor.noLocation': 'কোনো অবস্থান দেওয়া হয়নি',
  'editor.useCurrent': 'এখনকার অবস্থান',
  'editor.photoGpsPin': '{file} যেখানে তোলা, পিন সেখানেই বসেছে',
  'editor.placeName': 'জায়গার নাম (ঐচ্ছিক)',
  'editor.entryName': 'লেখাটির নাম (ঐচ্ছিক — না দিলে তারিখই নাম)',
  'editor.mood': 'মন (যেমন: ভাবুক, ক্লান্ত)',
  'editor.tags': 'ট্যাগ',
  'editor.markAsTrip': 'ভ্রমণ হিসেবে চিহ্নিত করুন',
  'editor.partOfTrip': 'ভ্রমণের অংশ',
  'editor.tripName': 'ভ্রমণের নাম (যেমন: নুরেমবার্গ সপ্তাহান্ত)',

  // ── Reading an entry ──
  'reader.mood': 'মন',
  'reader.trip': 'ভ্রমণ',
  'reader.weather': 'আবহাওয়া',
  'reader.tags': 'ট্যাগ',
  'reader.visited': 'গিয়েছেন',
  'reader.rating': 'মূল্যায়ন',
  'reader.backToDay': 'এই দিনের লেখাগুলিতে ফিরুন',
  'reader.deleteEntry': 'লেখা মুছুন',

  // ── Timeline ──
  'timeline.title': 'সময়রেখা',
  'timeline.layoutList': 'তালিকা',
  'timeline.layoutTiles': 'ছবির ঘর',
  'timeline.emptyTitle': 'আপনার দিনলিপি এখন ফাঁকা মানচিত্র',
  'timeline.emptyMessage': 'প্রথম লেখাটি লিখুন আর যেখানে আছেন সেখানে পিন দিন — সেটিই আপনার মানচিত্রের প্রথম চিহ্ন।',
  'timeline.openDay': 'গোটা দিনটি খুলুন (পথের মানচিত্র ও সব লেখা)',
  'timeline.deleteEntry': 'এই লেখাটি মুছুন',

  // ── One whole day ──
  'day.title': 'দিন',
  'day.close': 'দিনটি বন্ধ করুন',
  'day.deleteDay': 'দিন মুছুন',
  'day.deleteAll': '{count}টি লেখাই মুছুন',
  'day.noPins': 'এই দিনে কোনো অবস্থান পিন করা নেই।',
  'day.noEntriesLeft': 'এই দিনে আর কোনো লেখা নেই।',
  'day.distance': 'দূরত্ব',

  // ── Trips ──
  'trips.title': 'ভ্রমণ',
  'trips.emptyTitle': 'এখনও কোনো ভ্রমণ নেই',
  'trips.emptyMessage': 'লেখার সময় “ভ্রমণের অংশ” টিক দিয়ে একটি নাম দিন। একই নামের লেখাগুলি এখানে জমবে — সময়রেখাতেও যথারীতি থাকবে।',
  'trips.oneDay': 'একদিন',
  'trips.nDays': '{count} দিন',
  'trips.name': 'ভ্রমণের নাম',

  // ── Search & its filter chips ──
  'search.placeholder': 'শব্দ, জায়গা বা ট্যাগ দিয়ে খুঁজুন…',
  'search.hasPhoto': 'ছবি আছে',
  'search.hasAudio': 'অডিও আছে',
  'search.hasLocation': 'অবস্থান আছে',
  'search.mood': 'মন',
  'search.trip': 'ভ্রমণ',
  'search.dateFrom': 'তারিখ থেকে',
  'search.dateTo': 'তারিখ পর্যন্ত',
  'search.nearMe': 'আমার কাছে',
  'search.clearAll': 'সব সাফ',
  'search.oneFilter': 'একটি ফিল্টার',
  'search.nFilters': '{count}টি ফিল্টার',
  'search.anyMood': 'যেকোনো মন',
  'search.anyTrip': 'যেকোনো ভ্রমণ',
  'search.within': 'দূরত্ব',
  'search.ofYourLocation': 'আপনার অবস্থান থেকে',
  'search.ofMapCentre': 'মানচিত্রের কেন্দ্র থেকে',
  'search.locationUnknown': 'অবস্থান জানা নেই — মানচিত্র খুলুন বা GPS চালু করুন',
  'search.nearMeHint': 'শুধু এখান থেকে নির্দিষ্ট দূরত্বের লেখাগুলি দেখান',
  'search.oneMatch': 'একটি মিল',
  'search.nMatches': '{count}টি মিল',
  'search.noMatchesTitle': 'কিছু মেলেনি',
  'search.noMatches': '“{query}” দিয়ে কিছু পাওয়া গেল না। অন্য শব্দ, জায়গা বা ট্যাগ দিয়ে দেখুন।',
  'search.noMatchesNearby': '{radius} কিমির মধ্যে কিছু নেই। আরও বড় দূরত্ব বা অন্য শব্দ দিয়ে দেখুন।',

  // ── Settings ──
  'settings.title': 'সেটিংস',
  'settings.aboutYou': 'আপনার সম্পর্কে',
  'settings.display': 'প্রদর্শন',
  'settings.appearance': 'রূপ',
  'settings.welcomeScreen': 'স্বাগত পর্দা',
  'settings.map': 'মানচিত্র',
  'settings.calendar': 'বর্ষপঞ্জি',
  'settings.dictation': 'বলে লেখা',
  'settings.privacy': 'গোপনীয়তা ও নেটওয়ার্ক',
  'settings.language': 'ভাষা',
  'settings.advanced': 'বিশদ সেটিংস',
  'settings.name': 'নাম',
  'settings.titleRole': 'পদ / পরিচয়',
  'settings.homeRegion': 'নিজের অঞ্চল',
  'settings.coordFormat': 'অক্ষাংশ-দ্রাঘিমার ধরন',
  'settings.tempUnit': 'তাপমাত্রার একক',
  'settings.textSize': 'লেখার আকার',
  'settings.theme': 'থিম',
  'settings.themeLight': 'উজ্জ্বল',
  'settings.themeDark': 'অন্ধকার',
  'settings.themeSystem': 'যন্ত্র অনুযায়ী',
  'settings.weatherTint': 'আবহাওয়ার রঙে পটভূমি',
  'settings.livingBackdrop': 'জীবন্ত প্রাকৃতিক পটভূমি',
  'settings.cardOpacity': 'কার্ড ও প্যানেলের ঘনত্ব',
  'settings.focusCard': 'আজকের বিষয়ের কার্ড',
  'settings.writingPrompt': 'রোজের লেখার সূত্র',
  'settings.routeLine': 'লেখাগুলির মধ্যে পথরেখা আঁকুন',
  'settings.poiPins': 'মানচিত্রে দর্শনীয় স্থান',
  'settings.heatmap': 'কোথায় কোথায় গিয়েছি (হিটম্যাপ)',
  'settings.holidayCountry': 'ছুটির জন্য দেশ',
  'settings.holidayRegion': 'অঞ্চল / রাজ্য (আঞ্চলিক ছুটির জন্য)',
  'settings.onlineLookups': 'অনলাইনে জায়গার নাম খুঁজুন',
  'settings.autoFillPlace': 'পিন দিলে জায়গার নাম নিজেই বসবে',
  'settings.photoGps': 'ছবির নিজের GPS ব্যবহার করুন',
  'settings.dictationLang': 'বলে লেখার ভাষা',
  'settings.followDevice': 'যন্ত্র অনুযায়ী',
  'settings.graphicsQuality': 'গ্রাফিক্সের মান',
  'settings.savedLocally': 'এই যন্ত্রে সংরক্ষিত',
  'settings.resetAll': 'সব সেটিংস পুনঃস্থাপন',
  'settings.resetTitle': 'সব সেটিংস পুনঃস্থাপন করবেন?',
  'settings.resetBody': 'আপনার নাম, একক ও পছন্দ আগের অবস্থায় ফিরবে। দিনলিপির লেখা অক্ষত থাকবে।',
  'settings.installApp': 'অ্যাপ ইনস্টল করুন',
  'settings.uiLanguage': 'অ্যাপের ভাষা',
  'settings.uiLanguageHint': 'শুধু Meridian-এর নিজের লেখাগুলি অনুবাদ হয়। আপনি যে ভাষায় লিখবেন, লেখা সেই ভাষাতেই থাকবে।',

  // ── Data, backup and export ──
  'data.title': 'তথ্য',
  'data.exportFile': 'ফাইল রপ্তানি',
  'data.importFile': 'ফাইল আমদানি',
  'data.copyAll': 'সব কপি করুন',
  'data.pasteImport': 'পেস্ট করে আমদানি',
  'data.pastePlaceholder': 'রপ্তানি করা JSON এখানে পেস্ট করুন…',
  'data.exportMarkdown': 'Markdown বান্ডিল রপ্তানি',
  'data.printPdf': 'ছাপুন / PDF হিসেবে সংরক্ষণ',
  'data.exportGeoJSON': 'GeoJSON রপ্তানি',
  'data.exportGpx': 'GPX রপ্তানি',
  'data.exportForGis': 'মানচিত্র ও GIS-এর জন্য রপ্তানি',
  'data.noRecords': 'এখনও কোনো নথি নেই',
  'data.imported': '{added}টি নতুন এসেছে, {updated}টি হালনাগাদ, {kept}টি স্থানীয় নতুনতর রাখা হয়েছে।',
  'data.importFailed': 'আমদানি হয়নি: {message}',

  // ── Errors, empty states and confirmations ──
  'error.title': 'কিছু ভুল হয়েছে',
  'error.generic': 'কিছু ভুল হয়েছে। আবার চেষ্টা করুন।',
  'error.offline': 'আপনি অফলাইন — এর জন্য সংযোগ দরকার।',
  'error.reload': 'আবার লোড করুন',
  'error.locationDenied': 'অবস্থান নেওয়া বন্ধ আছে। ব্রাউজারের সেটিংসে অনুমতি দিন।',
  'error.locationUnavailable': 'আপনার অবস্থান পাওয়া গেল না।',
  'error.storageFull': 'জায়গা ভরে গেছে — কিছু জায়গা খালি করে আবার চেষ্টা করুন।',
  'empty.noEntries': 'এখনও কোনো লেখা নেই',
  'empty.noResults': 'দেখানোর কিছু নেই',
  'confirm.deleteEntryTitle': 'এই লেখাটি মুছবেন?',
  'confirm.deleteEntryBody': 'এটি সময়রেখা ও মানচিত্র থেকে সরে যাবে। আর ফেরানো যাবে না।',
  'confirm.deleteDayTitle': '{date}-এর সব লেখা মুছবেন?',
};
