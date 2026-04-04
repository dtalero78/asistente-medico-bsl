// Elementos del DOM
export const ringBox = document.getElementById('ringBox');
export const callButton = document.getElementById('callButton');
export const endCallBtn = document.getElementById('endCallBtn');
export const callStatus = document.querySelector('.call-status');
export const timer = document.querySelector('.timer');
export const speakNow = document.querySelector('.speak-now');
export const loader = document.querySelector('.loader');

// Inicializar estado visual
speakNow.style.display = 'none';
timer.style.display = 'none';

export function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

export function showModal(title, message, buttonText = 'Entendido') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'modal-title');

    const modal = document.createElement('div');
    modal.className = 'modal-content';

    modal.innerHTML = `
        <h3 id="modal-title" style="color: #333; margin-bottom: 15px;">${title}</h3>
        <p style="color: #666; margin-bottom: 20px; line-height: 1.5;">${message}</p>
        <button class="modal-close-btn">${buttonText}</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeBtn = modal.querySelector('.modal-close-btn');
    closeBtn.focus();

    function closeModal() {
        overlay.remove();
        callButton.focus();
    }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === 'Tab') {
            e.preventDefault();
            closeBtn.focus();
        }
    });
}
