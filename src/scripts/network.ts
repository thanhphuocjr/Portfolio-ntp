import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const SVG = 'http://www.w3.org/2000/svg';

interface Edge {
  path: SVGPathElement;
  from: HTMLElement;
  to: HTMLElement;
}

/**
 * Draws the skill diagram as a real feed-forward network: every node connects to
 * every node in the next layer, hover lights the direct connections, and a "forward
 * pass" pulse keeps travelling through while the section is on screen.
 */
export function initNetwork(root: HTMLElement) {
  const svg = root.querySelector<SVGSVGElement>('[data-net-edges]');
  if (!svg) return;
  const layers = [...root.querySelectorAll<HTMLElement>('[data-net-layer]')].map((layer) => [
    ...layer.querySelectorAll<HTMLElement>('[data-net-node]'),
  ]);
  if (layers.length < 2) return;

  let edges: Edge[] = [];

  const build = () => {
    svg.replaceChildren();
    edges = [];
    const box = root.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    for (let l = 0; l < layers.length - 1; l++) {
      for (const from of layers[l]) {
        for (const to of layers[l + 1]) {
          const a = from.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          const x1 = a.right - box.left;
          const y1 = a.top + a.height / 2 - box.top;
          const x2 = b.left - box.left;
          const y2 = b.top + b.height / 2 - box.top;
          const bend = (x2 - x1) * 0.5;
          const path = document.createElementNS(SVG, 'path');
          path.setAttribute('d', `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`);
          svg.append(path);
          edges.push({ path, from, to });
        }
      }
    }
  };

  const lit = (node: HTMLElement | null) => {
    for (const edge of edges) {
      const on = node !== null && (edge.from === node || edge.to === node);
      edge.path.classList.toggle('is-lit', on);
      if (node) {
        if (edge.from === node) edge.to.classList.toggle('is-lit', true);
        if (edge.to === node) edge.from.classList.toggle('is-lit', true);
      }
    }
    if (!node) layers.flat().forEach((n) => n.classList.remove('is-lit'));
  };

  for (const node of layers.flat()) {
    node.addEventListener('pointerenter', () => lit(node));
    node.addEventListener('pointerleave', () => lit(null));
    node.addEventListener('focus', () => lit(node));
    node.addEventListener('blur', () => lit(null));
  }

  // Forward pass: one pulse per layer gap, through a random route.
  let running = false;
  const forwardPass = () => {
    if (!running || !edges.length) return;
    const route: Edge[] = [];
    let current = layers[0][Math.floor(Math.random() * layers[0].length)];
    for (let l = 0; l < layers.length - 1; l++) {
      const options = edges.filter((e) => e.from === current);
      const edge = options[Math.floor(Math.random() * options.length)];
      if (!edge) return;
      route.push(edge);
      current = edge.to;
    }

    const flash = (node: HTMLElement) => {
      node.classList.add('is-hit');
      gsap.delayedCall(0.28, () => node.classList.remove('is-hit'));
    };

    const tl = gsap.timeline({ onComplete: () => void gsap.delayedCall(0.5, forwardPass) });
    tl.call(flash, [route[0].from]);
    route.forEach((edge) => {
      const pulse = edge.path.cloneNode() as SVGPathElement;
      const length = edge.path.getTotalLength();
      pulse.setAttribute('class', 'net__pulse');
      pulse.style.strokeDasharray = `${Math.min(70, length)} ${length * 2}`;
      tl.call(() => void svg.append(pulse));
      tl.fromTo(
        pulse,
        { strokeDashoffset: Math.min(70, length) },
        { strokeDashoffset: -length, duration: 0.5, ease: 'none', onComplete: () => pulse.remove() },
      );
      tl.call(flash, [edge.to], '-=0.12');
    });
  };

  const desktop = matchMedia('(min-width: 900px)');
  const update = () => {
    if (desktop.matches) {
      build();
    } else {
      svg.replaceChildren();
      edges = [];
    }
  };
  update();
  new ResizeObserver(update).observe(root);
  document.fonts?.ready.then(update);

  ScrollTrigger.create({
    trigger: root,
    start: 'top 80%',
    end: 'bottom 20%',
    onToggle(self) {
      const wasRunning = running;
      running = self.isActive && desktop.matches;
      if (running && !wasRunning) forwardPass();
    },
  });
}
