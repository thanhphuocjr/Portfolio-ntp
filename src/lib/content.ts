import type { ImageMetadata } from 'astro';
import raw from '../../noi-dung.txt?raw';

type Value = string | string[];
type Block = Record<string, Value>;
type Parsed = Record<string, Block | Block[]>;

const images = import.meta.glob<{ default: ImageMetadata }>(
  '/media/**/*.{jpg,jpeg,png,webp,avif,svg,JPG,JPEG,PNG,WEBP}',
  { eager: true },
);
const documents = import.meta.glob<string>('/media/**/*.pdf', {
  eager: true,
  query: '?url',
  import: 'default',
});

const DEV = import.meta.env.DEV;

/**
 * Reads noi-dung.txt:
 *   [muc]      a section          [[muc]]   one repeatable entry
 *   khoa: x    a field            - x       a list item of the current field
 *   # ...      a comment          other     continues the current field on a new line
 */
export function parse(text: string): Parsed {
  const root: Parsed = {};
  let target: Block | null = null;
  let key: string | null = null;

  // NFC matters: macOS often saves Vietnamese decomposed, which breaks per-letter animation.
  for (const line of text.normalize('NFC').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    const repeat = t.match(/^\[\[([\w-]+)\]\]$/);
    if (repeat) {
      const list = (root[repeat[1]] ??= []) as Block[];
      list.push((target = {}));
      key = null;
      continue;
    }
    const single = t.match(/^\[([\w-]+)\]$/);
    if (single) {
      root[single[1]] = target = {};
      key = null;
      continue;
    }
    if (!target) continue;

    if (t === '-' || t.startsWith('- ')) {
      if (!key) continue;
      const item = t.slice(1).trim();
      if (!Array.isArray(target[key])) target[key] = [];
      if (item) (target[key] as string[]).push(item);
      continue;
    }
    // The space after the colon is optional. Only "//" rules a match out, so a URL on a
    // continuation line is never read as a key.
    const field = t.match(/^([a-z0-9_]+):(?!\/\/)\s*(.*)$/);
    if (field) {
      key = field[1];
      target[key] = (field[2] ?? '').trim();
      continue;
    }
    if (key) {
      const current = target[key];
      target[key] = typeof current === 'string' && current ? `${current}\n${t}` : t;
    }
  }
  return root;
}

const str = (b: Block | undefined, k: string): string => {
  const v = b?.[k];
  return typeof v === 'string' ? v : '';
};
const arr = (b: Block | undefined, k: string): string[] => {
  const v = b?.[k];
  return Array.isArray(v) ? v : [];
};
const pipes = (b: Block | undefined, k: string): string[] =>
  str(b, k).split('|').map((s) => s.trim()).filter(Boolean);

/** Escapes HTML and turns *word* into a highlight. */
export function inline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<mark>$1</mark>');
}

export interface MediaRef {
  /** Where the file belongs, shown on the placeholder while developing. */
  path: string;
  image?: ImageMetadata;
}

const nameOnly = (path: string) => path.toLowerCase().replace(/\.[^./]+$/, '');

/** Forgiving about capitals and file type: a field saying avatar.png also finds Avatar.JPG. */
function media(file: string): MediaRef {
  if (!file) return { path: '' };
  const wanted = `/media/${file}`;
  const key = images[wanted] ? wanted : Object.keys(images).find((k) => nameOnly(k) === nameOnly(wanted));
  return { path: `media/${file}`, image: key ? images[key].default : undefined };
}

/** Field names are Vietnamese in the content file, but the checklist on the page stays in English. */
const SECTION_NAMES: Record<string, string> = {
  'so-lieu': 'Stat',
  'kinh-nghiem': 'Experience',
  'du-an': 'Project',
  'ky-nang': 'Skill group',
  'hoc-van': 'Education',
  'thanh-tuu': 'Recognition',
};
const FIELD_NAMES: Record<string, string> = {
  ho_ten: 'name',
  chuc_danh: 'job title',
  mo_ta_ngan: 'short intro',
  noi_dung: 'text',
  thoi_gian: 'period',
  vi_tri: 'role',
  cong_ty: 'company',
  ten: 'name',
  mo_ta: 'description',
  nhom: 'group name',
  cac_muc: 'skills',
  gia_tri: 'value',
  nhan: 'label',
};

const SOCIAL_LABELS: Record<string, string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  huggingface: 'Hugging Face',
  scholar: 'Google Scholar',
  x: 'X',
  facebook: 'Facebook',
  youtube: 'YouTube',
  medium: 'Medium',
  kaggle: 'Kaggle',
};

export function getContent() {
  const data = parse(raw);
  const one = (k: string) => (Array.isArray(data[k]) ? undefined : (data[k] as Block | undefined));
  const many = (k: string) => (Array.isArray(data[k]) ? (data[k] as Block[]) : []);

  const missing: string[] = [];
  const need = (b: Block | undefined, where: string, keys: string[]) => {
    for (const k of keys) if (!str(b, k)) missing.push(`${where} → ${FIELD_NAMES[k] ?? k}`);
  };
  const needImage = (ref: MediaRef, where: string) => {
    if (ref.path && !ref.image) missing.push(`${where} → missing image ${ref.path}`);
  };

  /** Empty entries stay visible as placeholders in dev and are dropped from the real site. */
  const entries = <T,>(
    section: string,
    fields: string[],
    required: string[],
    build: (b: Block, index: number) => T,
  ): T[] => {
    const blocks = many(section);
    const filled = (b: Block) => fields.some((k) => str(b, k) || arr(b, k).length);
    const used = blocks.filter(filled);
    used.forEach((b) => need(b, `${SECTION_NAMES[section]} ${blocks.indexOf(b) + 1}`, required));
    return (DEV ? blocks : used).map(build);
  };

  const i = one('thong-tin');
  const name = str(i, 'ho_ten');
  const initials =
    str(i, 'ten_viet_tat') ||
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join('')
      .slice(0, 4);

  need(i, 'Profile', ['ho_ten', 'chuc_danh', 'mo_ta_ngan', 'email']);

  const avatar = media(str(i, 'anh_dai_dien'));
  const aboutImage = media(str(i, 'anh_gioi_thieu'));
  const ogImage = media(str(i, 'anh_chia_se'));
  needImage(avatar, 'Portrait');
  needImage(aboutImage, 'About photo');
  needImage(ogImage, 'Link preview image');

  const cvFile = str(i, 'file_cv');
  const cv = cvFile ? documents[`/media/${cvFile}`] : undefined;
  if (cvFile && !cv) missing.push(`CV → missing file media/${cvFile}`);

  const socials = Object.entries(one('mang-xa-hoi') ?? {})
    .filter(([, url]) => typeof url === 'string' && url)
    .map(([k, url]) => ({
      label: SOCIAL_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1),
      url: url as string,
    }));

  const experience = entries(
    'kinh-nghiem',
    ['thoi_gian', 'vi_tri', 'cong_ty', 'mo_ta', 'thanh_tich', 'cong_nghe'],
    ['thoi_gian', 'vi_tri', 'cong_ty'],
    (b) => ({
      period: str(b, 'thoi_gian'),
      role: str(b, 'vi_tri'),
      company: str(b, 'cong_ty'),
      companyUrl: str(b, 'link_cong_ty'),
      location: str(b, 'dia_diem'),
      logo: media(str(b, 'logo')),
      summary: str(b, 'mo_ta'),
      wins: arr(b, 'thanh_tich'),
      tech: pipes(b, 'cong_nghe'),
    }),
  );

  const projects = entries(
    'du-an',
    ['ten', 'linh_vuc', 'mo_ta', 'tac_dong', 'vai_tro', 'cong_nghe', 'link_demo', 'link_code'],
    ['ten', 'mo_ta'],
    (b, index) => {
      const image = media(str(b, 'anh'));
      if (str(b, 'ten')) needImage(image, `Project ${index + 1}`);
      return {
        name: str(b, 'ten'),
        field: str(b, 'linh_vuc'),
        year: str(b, 'nam'),
        summary: str(b, 'mo_ta'),
        impact: str(b, 'tac_dong'),
        role: str(b, 'vai_tro'),
        tech: pipes(b, 'cong_nghe'),
        image,
        demo: str(b, 'link_demo'),
        code: str(b, 'link_code'),
      };
    },
  );

  const skills = entries('ky-nang', ['nhom', 'cac_muc'], ['nhom', 'cac_muc'], (b) => ({
    group: str(b, 'nhom'),
    items: pipes(b, 'cac_muc'),
  }));

  const credential = (b: Block) => ({
    period: str(b, 'thoi_gian'),
    title: str(b, 'ten'),
    issuer: str(b, 'noi_cap'),
    note: str(b, 'ghi_chu'),
    url: str(b, 'link'),
  });
  const credentialFields = ['thoi_gian', 'ten', 'noi_cap', 'ghi_chu', 'link'];
  const education = entries('hoc-van', credentialFields, ['ten'], credential);
  const recognition = entries('thanh-tuu', credentialFields, ['ten'], credential);

  const stats = entries('so-lieu', ['gia_tri', 'nhan'], ['gia_tri', 'nhan'], (b) => ({
    value: str(b, 'gia_tri'),
    label: str(b, 'nhan'),
  }));

  const aboutBlock = one('gioi-thieu');
  const about = str(aboutBlock, 'noi_dung');
  need(aboutBlock, 'About', ['noi_dung']);
  if (!experience.some((e) => e.role || e.company)) missing.push('Experience → no entries yet');
  if (!projects.some((p) => p.name)) missing.push('Project → no entries yet');

  const contact = one('lien-he');
  const formKey = str(contact, 'khoa_form');
  if (!formKey) missing.push("Contact → form key (without it, the form opens the visitor's mail app)");
  const labelsBlock = one('nhan');
  const label = (k: string, fallback: string) => str(labelsBlock, k) || fallback;

  const labels = {
    about: label('menu_gioi_thieu', 'About'),
    experience: label('menu_kinh_nghiem', 'Experience'),
    work: label('menu_du_an', 'Work'),
    stack: label('menu_ky_nang', 'Stack'),
    education: label('menu_hoc_van', 'Education'),
    contact: label('menu_lien_he', 'Contact'),
    experienceTitle: label('tieu_de_kinh_nghiem', 'Experience'),
    workTitle: label('tieu_de_du_an', 'Selected work'),
    stackTitle: label('tieu_de_ky_nang', 'What I build with'),
    educationTitle: label('tieu_de_hoc_van', 'Education'),
    recognitionTitle: label('tieu_de_thanh_tuu', 'Recognition'),
    viewWork: label('nut_xem_du_an', 'View my work'),
    downloadCv: label('nut_tai_cv', 'Download CV'),
    send: label('nut_gui', 'Send'),
    formName: label('form_ten', 'Your name'),
    formEmail: label('form_email', 'Your email'),
    formMessage: label('form_loi_nhan', 'Your message'),
    formSent: label('form_da_gui', "Message sent. I'll get back to you soon."),
    formFailed: label('form_that_bai', "Couldn't send your message. Please email me directly:"),
    impact: label('tac_dong', 'Impact'),
    role: label('vai_tro', 'Role'),
    demo: label('xem_demo', 'Live demo'),
    code: label('xem_code', 'Source code'),
  };

  const showAbout = DEV || !!about;
  const showExperience = experience.length > 0;
  const showWork = projects.length > 0;
  const showStack = skills.length > 0;
  const showCredentials = education.length + recognition.length > 0;

  const nav = [
    showAbout && { id: 'about', label: labels.about },
    showExperience && { id: 'experience', label: labels.experience },
    showWork && { id: 'work', label: labels.work },
    showStack && { id: 'stack', label: labels.stack },
    showCredentials && { id: 'education', label: labels.education },
    { id: 'contact', label: labels.contact },
  ].filter(Boolean) as { id: string; label: string }[];

  return {
    isDev: DEV,
    missing,
    info: {
      name,
      initials,
      title: str(i, 'chuc_danh'),
      tagline: str(i, 'khau_hieu'),
      intro: str(i, 'mo_ta_ngan'),
      status: str(i, 'trang_thai'),
      location: str(i, 'dia_diem'),
      email: str(i, 'email'),
      phone: str(i, 'so_dien_thoai'),
      website: str(i, 'website'),
      avatar,
      aboutImage,
      ogImage,
      cv,
    },
    socials,
    about,
    stats,
    experience,
    projects,
    skills,
    education,
    recognition,
    contact: {
      title: str(contact, 'tieu_de'),
      text: str(contact, 'mo_ta'),
      prompts: arr(contact, 'goi_y'),
      formKey,
    },
    labels,
    nav,
    show: {
      about: showAbout,
      experience: showExperience,
      work: showWork,
      stack: showStack,
      credentials: showCredentials,
    },
  };
}

export type Content = ReturnType<typeof getContent>;
