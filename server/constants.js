export const ROLES = ['System admin', 'Supervisor', 'Registrar', 'Unit'];

export const URGENCIES = ['عاجل وعلى الفور', 'عاجل جدا', 'عاجل', 'عادي'];

export const STATUSES = [
  'pending',
  'in_progress',
  'reported_done',
  'confirmed_done',
  'not_done',
];

export const STATUS_LABELS_AR = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد الإنجاز',
  reported_done: 'بانتظار التأكيد',
  confirmed_done: 'منجز ومؤكد',
  not_done: 'تعذر الإنجاز',
};

export const ALLOWED_IMAGE_MIMES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

