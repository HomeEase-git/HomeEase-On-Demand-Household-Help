export default function DocumentViewer({ documents = [] }) {
  if (!documents.length) {
    return (
      <div className="document-viewer document-viewer--empty">
        No documents uploaded yet.
      </div>
    );
  }

  return (
    <div className="document-viewer">
      {documents.map((doc) => {
        const isImage = doc.mimeType?.startsWith('image/');
        const isPdf = doc.mimeType === 'application/pdf';

        return (
          <div key={doc.id || doc.name} className="document-viewer__item">
            <div className="document-viewer__header">
              <span className="document-viewer__name">{doc.name}</span>
              <a href={doc.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Open
              </a>
            </div>
            {isImage && (
              <img src={doc.url} alt={doc.name} className="document-viewer__preview" />
            )}
            {isPdf && (
              <iframe
                src={doc.url}
                title={doc.name}
                className="document-viewer__iframe"
              />
            )}
            {!isImage && !isPdf && (
              <div className="document-viewer__fallback">
                Preview not available for this file type.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
