export function StatusPanel({ status, selectedFolder, error }) {
  return (
    <section className="meta">
      <p className="status">{status}</p>
      {selectedFolder && <p className="folder">{selectedFolder}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
