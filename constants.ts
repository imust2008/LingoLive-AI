
import { Language, Scenario, ProficiencyLevel } from './types';

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'es-ES', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr-FR', name: 'French', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German', flag: '🇩🇪' },
  { code: 'ja-JP', name: 'Japanese', flag: '🇯🇵' },
  { code: 'it-IT', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt-BR', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'zh-CN', name: 'Mandarin', flag: '🇨🇳' },
];

export const SCENARIOS: Scenario[] = [
  { id: 'casual', title: 'Casual Coffee Chat', description: 'Practice basic greetings and small talk in a relaxed environment.', icon: '☕' },
  { id: 'restaurant', title: 'Ordering Food', description: 'Practice ordering dishes, asking about ingredients, and paying the bill.', icon: '🍽️' },
  { id: 'travel', title: 'At the Airport', description: 'Navigate check-in, security, and boarding processes.', icon: '✈️' },
  { id: 'job', title: 'Job Interview', description: 'Simulate a professional interview and discuss your skills and experience.', icon: '💼' },
  { id: 'doctor', title: 'At the Doctor', description: 'Explain symptoms and understand medical advice.', icon: '🩺' },
];

export const LEVELS: ProficiencyLevel[] = [
  ProficiencyLevel.BEGINNER,
  ProficiencyLevel.INTERMEDIATE,
  ProficiencyLevel.ADVANCED
];
