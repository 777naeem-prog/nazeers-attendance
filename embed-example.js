/* How the host system mounts the module. Swap the storage for the host's own database:
   load() returns the saved object (or null), save(data) stores it. */
const storage = {
  load() { return JSON.parse(localStorage.getItem('host-attendance') || 'null'); },
  save(data) {
    localStorage.setItem('host-attendance', JSON.stringify(data));
    // e.g. fetch('/api/attendance', { method: 'PUT', body: JSON.stringify(data) });
  },
};
const attendance = NMSAttendance.mount(document.getElementById('staff-attendance'), {
  storage,
  startTab: 'today',
  onChange(data) { /* the host can react, e.g. post wages to its accounts */ },
});
