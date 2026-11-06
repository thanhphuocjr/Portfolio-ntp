import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { createField, type Field, type ShapeName } from './field';
import { initNetwork } from './network';
import { denoiseImage } from './denoise';

gsap.registerPlugin(ScrollTrigger, SplitText);

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(s),
];

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lenis: Lenis | null = null;

/** Things that must work with or without motion. */
function initBasics() {
  const toggle = $<HTMLButtonElement>('[data-menu-toggle]');
  const menu = $('[data-menu]');
  const setMenu = (open: boolean) => {
    if (!toggle || !menu) return;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
    if (open) lenis?.stop();
    else lenis?.start();
    if (open && !reduced) {
      gsap.from($$('a', menu), { y: 26, autoAlpha: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out' });
    }
  };
  toggle?.addEventListener('click', () => setMenu(menu?.hidden ?? false));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu && !menu.hidden) {
      setMenu(false);
      toggle?.focus();
    }
  });

  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href')!;
    const target = hash.length > 1 ? $(hash) : null;
    if (!target) return;
    e.preventDefault();
    if (menu && !menu.hidden) setMenu(false);
    if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.3 });
    else target.scrollIntoView();
    history.replaceState(null, '', hash);
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  initPrompt();
}

/**
 * Sends the contact form through Web3Forms, which emails it to the site owner.
 * With no key configured, it hands the message to the visitor's own mail app instead.
 */
function initPrompt() {
  const form = $<HTMLFormElement>('[data-prompt]');
  const input = $<HTMLTextAreaElement>('[data-prompt-input]');
  const status = $('[data-prompt-status]');
  if (!form || !input || !status) return;
  const { email = '', key = '', sent = '', failed = '' } = form.dataset;
  const button = $<HTMLButtonElement>('button[type="submit"]', form);

  // Browsers word their own validation bubbles in their interface language, so spell them out.
  const problems: Record<string, { missing: string; invalid?: string }> = {
    name: { missing: 'Please enter your name.' },
    email: { missing: 'Please enter your email.', invalid: 'Please enter a valid email address.' },
    message: { missing: 'Please write a message.' },
  };
  const fields = $$<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"], [type="checkbox"]), textarea', form);
  for (const field of fields) {
    const problem = problems[field.name];
    field.addEventListener('invalid', () => {
      field.setCustomValidity(field.value.trim() ? (problem?.invalid ?? '') : (problem?.missing ?? ''));
    });
    field.addEventListener('input', () => field.setCustomValidity(''));
  }

  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 1}px`;
  };
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });

  const say = (state: 'sending' | 'sent' | 'failed', text: string) => {
    status.dataset.state = state;
    status.textContent = text;
  };
  const mailLink = (name: string, from: string, message: string) => {
    const subject = encodeURIComponent(`Message from ${name}`);
    const body = encodeURIComponent(`${message}\n\n${name} <${from}>`);
    return `mailto:${email}?subject=${subject}&body=${body}`;
  };

  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    // `required` accepts a field holding only spaces, so catch that here.
    const blank = fields.find((field) => !field.value.trim());
    if (blank) {
      blank.setCustomValidity(problems[blank.name]?.missing ?? '');
      blank.reportValidity();
      return;
    }
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const from = String(data.get('email') ?? '').trim();
    const message = String(data.get('message') ?? '').trim();

    if (!key) {
      if (!email) {
        say('failed', 'Add a form key or an email address first.');
        return;
      }
      location.href = mailLink(name, from, message);
      say('sent', 'Opening your mail app…');
      return;
    }

    sending = true;
    if (button) button.disabled = true;
    say('sending', 'Sending…');
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 15000);
    try {
      // FormData, not JSON: it needs no CORS preflight, and the service's firewall rejects
      // OPTIONS requests from some clients before they ever reach the form.
      const response = await fetch(form.getAttribute('action')!, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: data,
        signal: abort.signal,
      });
      const result = await response.json().catch(() => null);
      // Only an explicit success counts. Claiming "sent" on anything else could silently lose a message.
      if (!response.ok || result?.success !== true) throw new Error(result?.message ?? `HTTP ${response.status}`);
      form.reset();
      input.style.height = '';
      say('sent', sent);
    } catch {
      // Whatever went wrong, the visitor keeps what they typed and gets a way to still reach out.
      say('failed', failed);
      if (email) {
        const link = document.createElement('a');
        link.href = mailLink(name, from, message);
        link.textContent = email;
        status.append(' ', link);
      }
    } finally {
      clearTimeout(timer);
      sending = false;
      if (button) button.disabled = false;
    }
  });

  // Suggestions type themselves into the placeholder while the box is empty and idle.
  const prompts: string[] = JSON.parse(form.dataset.prompts ?? '[]');
  if (reduced || prompts.length < 2) return;
  let index = 0;
  let timer = 0;
  const typeNext = () => {
    if (document.activeElement === input || input.value) {
      timer = window.setTimeout(typeNext, 1500);
      return;
    }
    const text = prompts[index++ % prompts.length];
    let i = 0;
    const step = () => {
      if (document.activeElement === input || input.value) {
        input.placeholder = text;
        timer = window.setTimeout(typeNext, 1500);
        return;
      }
      input.placeholder = text.slice(0, ++i);
      timer = window.setTimeout(i < text.length ? step : typeNext, i < text.length ? 34 : 2600);
    };
    step();
  };
  ScrollTrigger.create({
    trigger: form,
    start: 'top 90%',
    once: true,
    onEnter: () => {
      clearTimeout(timer);
      typeNext();
    },
  });
}

function initSmoothScroll() {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

function initField(): { field: Field | null; intro: { v: number } } {
  const canvas = $<HTMLCanvasElement>('[data-field]');
  const intro = { v: 0 };
  if (!canvas) return { field: null, intro };

  const stops = $$('[data-shape]');
  const sequence: ShapeName[] = ['noise', 'portrait', ...stops.map((s) => s.dataset.shape as ShapeName)];
  let field: Field | null = null;
  try {
    field = createField(canvas, sequence, { still: reduced });
  } catch {
    canvas.remove();
  }
  if (!field) return { field: null, intro };

  if (reduced) {
    field.setProgress(1);
    field.renderOnce();
    field.ready.then(() => field?.renderOnce());
    addEventListener('resize', () => field?.renderOnce(), { passive: true });
    return { field, intro };
  }

  // Each section nudges the sequence on by one as its top rolls through the viewport.
  const triggers = stops.map((section) =>
    ScrollTrigger.create({ trigger: section, start: 'top 92%', end: 'top 28%' }),
  );
  gsap.ticker.add((_, deltaMs) => {
    let p = intro.v;
    for (const t of triggers) p += t.progress;
    field!.setProgress(p);
    field!.tick(Math.min(deltaMs, 50) / 1000);
  });
  return { field, intro };
}

function initProgress() {
  const bar = $('[data-progress]');
  const fill = $('[data-rail-fill]');
  const label = $('[data-rail-label]');
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate(self) {
      const p = self.progress;
      if (bar) bar.style.transform = `scaleX(${p})`;
      if (fill) fill.style.transform = `scaleY(${p})`;
      // 2.303 is ln(10): the loss every 10-class classifier starts training from.
      if (label) label.textContent = `loss ${(2.303 * Math.exp(-4.2 * p)).toFixed(3)}`;
    },
  });
}

function initNavBehaviour() {
  const nav = $('[data-nav]');
  if (nav) {
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate(self) {
        nav.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > innerHeight * 0.6);
      },
    });
  }
  const links = $$<HTMLAnchorElement>('[data-nav-link]');
  for (const link of links) {
    const section = document.getElementById(link.dataset.navLink!);
    if (!section) continue;
    ScrollTrigger.create({
      trigger: section,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle(self) {
        link.classList.toggle('is-active', self.isActive);
        if (self.isActive) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      },
    });
  }
}

function playIntro(field: Field | null, intro: { v: number }) {
  const name = $('[data-hero-name]');
  const stream = $('[data-stream]');
  const parts = $$('[data-intro]');
  const step = $('[data-sample-step]');

  // The name can be empty on the real site until it is filled in.
  const nameSplit = name?.textContent?.trim()
    ? SplitText.create(name, { type: 'words,chars' })
    : null;
  const streamSplit = stream?.textContent?.trim() ? SplitText.create(stream, { type: 'words' }) : null;
  const caret = document.createElement('span');
  caret.className = 'stream-caret';
  caret.setAttribute('aria-hidden', 'true');

  if (nameSplit) gsap.set(nameSplit.chars, { autoAlpha: 0, y: 22, filter: 'blur(16px)' });
  if (streamSplit) gsap.set(streamSplit.words, { autoAlpha: 0 });
  gsap.set(parts, { autoAlpha: 0, y: 14, filter: 'blur(8px)' });

  // Everything is in its starting state, so the page can safely become visible.
  clearTimeout((window as unknown as { __introFailsafe?: number }).__introFailsafe);
  document.documentElement.classList.remove('js');

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  if (field) {
    tl.to(
      intro,
      {
        v: 1,
        duration: 3.4,
        ease: 'power2.inOut',
        onUpdate() {
          if (step) step.textContent = `t=${String(Math.round((1 - intro.v) * 1000)).padStart(4, '0')}`;
        },
        onComplete() {
          if (step) step.textContent = 't=0000 ✓';
        },
      },
      0,
    );
  }
  if (nameSplit) {
    tl.to(
      nameSplit.chars,
      {
        autoAlpha: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 1.5,
        stagger: 0.04,
        ease: 'power2.out',
        // Back to plain text, so the name re-wraps normally when the window is resized.
        onComplete: () => nameSplit.revert(),
      },
      0.3,
    );
  }
  tl.to(parts, { autoAlpha: 1, y: 0, filter: 'blur(0px)', clearProps: 'filter', duration: 1.2, stagger: 0.12, ease: 'power2.out' }, 0.8);
  if (stream && streamSplit) {
    tl.call(() => void stream.append(caret), [], 1.3);
    // Tokens arrive in small uneven bursts, the way a model streams text.
    let at = 1.3;
    streamSplit.words.forEach((word, i) => {
      tl.call(() => void word.parentNode?.insertBefore(caret, word.nextSibling), [], at);
      tl.to(word, { autoAlpha: 1, duration: 0.45, ease: 'none' }, at);
      at += 0.07 + ((i * 7) % 5) * 0.028;
    });
    tl.call(
      () =>
        void gsap.to(caret, {
          autoAlpha: 0,
          duration: 0.3,
          delay: 2.2,
          onComplete: () => {
            caret.remove();
            streamSplit.revert();
          },
        }),
      [],
      at,
    );
  }
}

function showIntroWithoutMotion() {
  clearTimeout((window as unknown as { __introFailsafe?: number }).__introFailsafe);
  document.documentElement.classList.remove('js');
  const step = $('[data-sample-step]');
  if (step) step.textContent = 't=0000 ✓';
}

function initReveals() {
  for (const el of $$('[data-split]')) {
    SplitText.create(el, {
      type: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      // Lines surface out of the haze rather than sliding in.
      onSplit: (self) =>
        gsap.from(self.lines, {
          autoAlpha: 0,
          y: 26,
          filter: 'blur(14px)',
          clearProps: 'filter',
          duration: 1.6,
          stagger: 0.14,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        }),
    });
  }

  const reveals = $$('[data-reveal]');
  if (!reveals.length) return;
  gsap.set(reveals, { autoAlpha: 0, y: 22, filter: 'blur(8px)' });
  ScrollTrigger.batch(reveals, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        autoAlpha: 1,
        y: 0,
        filter: 'blur(0px)',
        clearProps: 'filter',
        duration: 1.25,
        stagger: 0.09,
        ease: 'power2.out',
      }),
  });
}

/** Tints each word as the reading head passes, then settles to plain text with keywords kept lit. */
function initAttention() {
  const root = $('[data-attention]');
  const words = root ? $$('.w', root) : [];
  if (!root || !words.length) return;
  const n = words.length;
  const span = Math.max(10, n * 0.14);
  const last = new Float32Array(n).fill(-1);

  const paint = (head: number) => {
    words.forEach((w, i) => {
      const distance = head - i;
      const reached = distance >= 0;
      const heat = reached ? Math.max(0, 1 - distance / span) : 0;
      const key = Math.round(heat * 40) / 40 + (reached ? 2 : 0);
      if (last[i] === key) return;
      last[i] = key;
      w.style.opacity = reached ? '1' : '0.2';
      if (heat > 0) {
        // A soft halo from deep to bright violet. It stops short of white so white text stays readable.
        const r = Math.round(75 + 68 * heat);
        const g = Math.round(31 + 64 * heat);
        const b = Math.round(209 + 46 * heat);
        w.style.background = `radial-gradient(closest-side, rgb(${r} ${g} ${b} / ${(0.3 + heat * 0.7).toFixed(2)}), transparent)`;
        w.style.textShadow = `0 0 0.45em rgb(246 242 255 / ${(heat * 0.85).toFixed(2)})`;
      } else {
        w.style.background = '';
        w.style.textShadow = '';
      }
    });
  };
  paint(-1);
  ScrollTrigger.create({
    trigger: root,
    start: 'top 74%',
    end: 'bottom 45%',
    scrub: true,
    onUpdate: (self) => paint(self.progress * (n + span)),
    onRefresh: (self) => paint(self.progress * (n + span)),
  });
}

function initCounters() {
  for (const el of $$('[data-count]')) {
    if (el.querySelector('.slot')) continue;
    const text = el.textContent?.trim() ?? '';
    const match = text.match(/^([^\d-]*)(-?[\d.,]+)(.*)$/);
    if (!match) continue;
    const [, before, digits, after] = match;
    const target = parseFloat(digits.replace(/,/g, ''));
    if (Number.isNaN(target)) continue;
    const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
    const state = { v: 0 };
    el.setAttribute('aria-label', text);
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () =>
        gsap.to(state, {
          v: target,
          duration: 1.6,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = `${before}${state.v.toFixed(decimals)}${after}`;
          },
          onComplete: () => {
            el.textContent = text;
          },
        }),
    });
  }
}

function initExperienceCurve() {
  const mm = gsap.matchMedia();
  mm.add('(min-width: 900px)', () => {
    const list = $('[data-xp-list]');
    const line = $<SVGPathElement>('[data-curve-line]');
    const head = $<SVGCircleElement>('[data-curve-head]');
    const dotsGroup = $('[data-curve-dots]');
    const readout = $('[data-curve-readout]');
    const jobs = $$('[data-job]');
    if (!list || !line || !head || !dotsGroup || !jobs.length) return;

    const length = line.getTotalLength();
    line.style.strokeDasharray = `${length}`;
    line.style.strokeDashoffset = `${length}`;
    list.classList.add('is-driven');

    let fractions: number[] = [];
    let dots: SVGCircleElement[] = [];
    const placeDots = () => {
      const listBox = list.getBoundingClientRect();
      fractions = jobs.map((job) => (job.getBoundingClientRect().top - listBox.top) / listBox.height);
      dotsGroup.replaceChildren();
      dots = fractions.map((f) => {
        const point = line.getPointAtLength(f * length);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(point.x));
        dot.setAttribute('cy', String(point.y));
        dot.setAttribute('r', '5');
        dot.setAttribute('class', 'curve__dot');
        dotsGroup.append(dot);
        return dot;
      });
    };

    let active = -1;
    const update = (p: number) => {
      line.style.strokeDashoffset = `${length * (1 - p)}`;
      const point = line.getPointAtLength(p * length);
      head.setAttribute('cx', String(point.x));
      head.setAttribute('cy', String(point.y));
      head.style.opacity = p > 0 && p < 1 ? '1' : '0';

      let current = 0;
      fractions.forEach((f, i) => {
        if (p >= f) current = i;
        dots[i]?.classList.toggle('is-on', p >= f && p > 0);
      });
      if (current !== active) {
        active = current;
        jobs.forEach((job, i) => job.classList.toggle('is-active', i === current));
        if (readout) {
          const job = jobs[current];
          readout.textContent = [job.dataset.ckpt, job.dataset.company].filter(Boolean).join(' · ');
        }
      }
    };

    placeDots();
    const trigger = ScrollTrigger.create({
      trigger: list,
      start: 'top 62%',
      end: 'bottom 62%',
      onRefresh: placeDots,
      onUpdate: (self) => update(self.progress),
    });
    update(trigger.progress);

    return () => {
      list.classList.remove('is-driven');
      trigger.kill();
    };
  });
}

function initCards() {
  for (const inner of $$('[data-card-inner]')) {
    inner.addEventListener('pointermove', (e) => {
      const box = inner.getBoundingClientRect();
      inner.style.setProperty('--mx', `${e.clientX - box.left}px`);
      inner.style.setProperty('--my', `${e.clientY - box.top}px`);
    });
  }

  // A card taller than the screen must not stick, or the next card covers its bottom
  // edge (and any links there) before it can ever be scrolled into view.
  const updateSticky = () => {
    for (const card of $$('[data-card]')) {
      const inner = $('[data-card-inner]', card);
      if (!inner) continue;
      const stickyTop = parseFloat(getComputedStyle(card).top) || 0;
      card.classList.toggle('card--flow', inner.offsetHeight + stickyTop + 16 > innerHeight);
    }
  };
  ScrollTrigger.addEventListener('refreshInit', updateSticky);
  updateSticky();

  const mm = gsap.matchMedia();
  mm.add('(min-width: 900px)', () => {
    const cards = $$('[data-card]');
    cards.forEach((card, i) => {
      const next = cards[i + 1];
      if (!next) return;
      const inner = $('[data-card-inner]', card);
      const shade = $('[data-card-shade]', card);
      const scrub = { trigger: next, start: 'top 92%', end: 'top 18%', scrub: true };
      if (inner) gsap.to(inner, { scale: 0.94, ease: 'none', scrollTrigger: scrub });
      if (shade) gsap.to(shade, { opacity: 0.62, ease: 'none', scrollTrigger: { ...scrub } });
    });
  });

  const allCards = $$('[data-card]');
  if (!allCards.length) return;
  gsap.set(allCards, { autoAlpha: 0, y: 56 });
  ScrollTrigger.batch(allCards, {
    start: 'top 92%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1.3, ease: 'power2.out', stagger: 0.12 }),
  });
}

function initImages() {
  for (const img of $$<HTMLImageElement>('img[data-denoise]')) {
    if (img.closest('.job__logo')) continue;
    ScrollTrigger.create({
      trigger: img.parentElement!,
      start: 'top 82%',
      once: true,
      onEnter: async () => {
        await img.decode().catch(() => undefined);
        denoiseImage(img);
      },
    });
  }
}

function initMagnetic() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const el of $$('[data-magnetic]')) {
    const x = gsap.quickTo(el, 'x', { duration: 0.45, ease: 'power3.out' });
    const y = gsap.quickTo(el, 'y', { duration: 0.45, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const box = el.getBoundingClientRect();
      x((e.clientX - box.left - box.width / 2) * 0.28);
      y((e.clientY - box.top - box.height / 2) * 0.42);
    });
    el.addEventListener('pointerleave', () => {
      x(0);
      y(0);
    });
  }
}

function initCursor() {
  const cursor = $('[data-cursor]');
  if (!cursor || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const x = gsap.quickTo(cursor, 'x', { duration: 0.28, ease: 'power3.out' });
  const y = gsap.quickTo(cursor, 'y', { duration: 0.28, ease: 'power3.out' });
  let seen = false;
  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!seen) {
        seen = true;
        gsap.set(cursor, { x: e.clientX, y: e.clientY });
        gsap.to(cursor, { opacity: 1, duration: 0.3 });
      }
      x(e.clientX);
      y(e.clientY);
      const over = (e.target as Element).closest?.('a, button, [data-net-node]');
      cursor.classList.toggle('is-active', !!over);
    },
    { passive: true },
  );
}

async function boot() {
  await Promise.race([document.fonts.ready, wait(900)]);

  if (reduced) {
    initBasics();
    initField();
    showIntroWithoutMotion();
    return;
  }

  initSmoothScroll();
  initBasics();
  const { field, intro } = initField();
  initProgress();
  initNavBehaviour();
  initReveals();
  initAttention();
  initCounters();
  initExperienceCurve();
  initCards();
  initImages();
  initMagnetic();
  initCursor();
  const net = $('[data-net]');
  if (net) initNetwork(net);

  // Give the portrait a moment to sample, but never hold the page back for it.
  if (field) await Promise.race([field.ready, wait(1200)]);
  playIntro(field, intro);
  ScrollTrigger.refresh();
}

boot();
