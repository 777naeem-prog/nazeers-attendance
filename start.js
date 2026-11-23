/* Stand-alone start-up: the whole app in one page. Records are kept on the phone and, once signed in,
   shared through the Nazeer's Motor Spares cloud database. The key is publishable: on its own it can
   read or write nothing — row-level security only lets in signed-in members. */
const cloud = NMSSync.create({
  url: 'https://oregkflpywtkdkqfrpbz.supabase.co',
  key: 'sb_publishable_78F4iY_ikXoGuPJlZOmQfA_GFiTL1nV',
  usernameDomain: 'nms-staff.invalid', // logins are short usernames; no e-mail is ever sent
});
window.attendanceApp = NMSAttendance.mount(document.getElementById('attendance'), { business: "Nazeer's Motor Spares", storage: cloud.storage, cloud, requireSignIn: true });
cloud.attach(window.attendanceApp);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
