let toastContainer: HTMLDivElement | null = null;

export function showToast(message: string, kind: 'error' | 'success' = 'success') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Fade out then remove (fade-only motion per design system)
  setTimeout(() => {
    toast.classList.add('toast-fade');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
