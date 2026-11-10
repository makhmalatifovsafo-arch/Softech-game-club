import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('NetCafeServer/public/index.html', 'utf8');
const source = html.slice(html.indexOf('    function initMarqueeSelection()'), html.indexOf("    // Mavzuni o'zgartirish"));
function setup() {
  const events = {};
  const listen = scope => (name, callback) => { events[scope + ':' + name] = callback; };
  const marquee = { style: {} };
  const container = { addEventListener: listen('container'), scrollLeft: 0, scrollTop: 200,
    getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  let cards = [];
  const context = { selectedPcIds: new Set(), isMainLayoutEdit: false, isPanning: false, isSpacePressed: false,
    updateMultiSelectUi() {},
    window: { addEventListener: listen('window') },
    document: { getElementById: id => id === 'mainContainer' ? container : id === 'selectionMarquee' ? marquee : null,
      body: { classList: { add() {}, remove() {} } }, addEventListener: listen('document'), querySelectorAll: () => cards } };
  vm.runInNewContext(source + '\ninitMarqueeSelection();', context);
  const target = { closest: selector => selector === '#view-workstations' || selector === '.softech-panel' || selector === '[data-pc-id]' ? target : null };
  const fire = (name, extra = {}) => {
    const event = { target, button: 0, buttons: 1, clientX: 10, clientY: 10,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    events[name](event); return event;
  };
  const card = (id, left, top, width = 30) => ({ getAttribute: () => id,
    getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + width, width, height: width }) });
  return { context, fire, marquee, setCards: value => { cards = value; }, card };
}

test('drag starts on an occupied card and survives session redraw without a follow-up card click', () => {
  const s = setup();
  s.setCards([s.card('occupied', 10, 10), s.card('available', 70, 10)]);
  s.fire('container:mousedown');
  s.fire('document:mousemove', { clientX: 45, clientY: 45 });
  s.setCards([s.card('occupied', 10, 10), s.card('available', 70, 10), s.card('hidden', 0, 0, 0)]);
  s.fire('document:mousemove', { clientX: 110, clientY: 50 });
  assert.deepEqual([...s.context.selectedPcIds], ['occupied', 'available']);
  assert.equal(s.marquee.style.top, '210px', 'Marquee accounts for the scrolled dashboard');
  s.fire('document:mouseup');
  assert.equal(s.fire('document:click').stopped, true);
  assert.deepEqual([...s.context.selectedPcIds], ['occupied', 'available']);
});

test('ordinary clicks and controls retain their normal behavior', () => {
  const s = setup();
  s.fire('container:mousedown');
  s.fire('document:mousemove', { clientX: 12 });
  s.fire('document:mouseup');
  assert.equal(s.fire('document:click').stopped, undefined);
  s.fire('container:mousedown', { target: { closest: () => ({}) } });
  s.fire('document:mousemove', { clientX: 100 });
  assert.notEqual(s.marquee.style.display, 'block');
});

test('modifier selection is additive and blur releases drag and pan state', () => {
  const s = setup();
  s.context.selectedPcIds.add('existing');
  s.setCards([s.card('new', 70, 10)]);
  s.fire('container:mousedown', { metaKey: true });
  s.fire('document:mousemove', { clientX: 110, clientY: 50 });
  assert.deepEqual([...s.context.selectedPcIds], ['existing', 'new']);
  s.context.isPanning = s.context.isSpacePressed = true;
  s.fire('window:blur');
  assert.equal(s.context.isPanning, false);
  assert.equal(s.context.isSpacePressed, false);
  assert.equal(s.marquee.style.display, 'none');
});
