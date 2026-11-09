export const OWL_AVATAR_IDS = [
  'book',
  'gamer',
  'lab',
  'detective',
  'wizard',
  'sport',
  'explorer',
  'sleepy',
  'idea',
  'scholar',
  'astronaut',
  'chef',
  'artist',
  'musician',
  'hero',
  'firefighter',
  'pirate',
  'angel',
  'mechanic',
  'king',
] as const;

export type OwlAvatarId = (typeof OWL_AVATAR_IDS)[number];

export const DEFAULT_OWL_AVATAR_ID: OwlAvatarId = 'book';

export function parseOwlAvatarId(value: unknown): OwlAvatarId {
  return typeof value === 'string' &&
    (OWL_AVATAR_IDS as readonly string[]).includes(value)
    ? (value as OwlAvatarId)
    : DEFAULT_OWL_AVATAR_ID;
}
