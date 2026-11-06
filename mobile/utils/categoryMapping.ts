export function mapServiceToCategory(workerService: string | null | undefined): string | null {
  if (!workerService) return null;
  return workerService.trim();
}

export default { mapServiceToCategory };
