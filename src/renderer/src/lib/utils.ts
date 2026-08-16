export type ClassValue = string | number | boolean | undefined | null | { [key: string]: any } | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const list: string[] = [];
  function process(item: ClassValue) {
    if (!item) return;
    if (typeof item === 'string' || typeof item === 'number') {
      list.push(String(item));
    } else if (Array.isArray(item)) {
      item.forEach(process);
    } else if (typeof item === 'object') {
      for (const key in item) {
        if (item[key]) list.push(key);
      }
    }
  }
  inputs.forEach(process);
  return list.join(' ');
}
