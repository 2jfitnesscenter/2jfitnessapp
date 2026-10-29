/** Delete selected library templates one by one; callers can report partial failures. */
export async function removeBlocksSequentially(ids, remove) {
  const deleted = []; const failed = []
  for (const id of [...new Set(ids)]) {
    try { await remove(id); deleted.push(id) } catch { failed.push(id) }
  }
  return { deleted, failed }
}
