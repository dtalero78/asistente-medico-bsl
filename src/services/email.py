import os
import logging
import smtplib
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def send_summary_email(message):
    """Envia el resumen de la llamada por email via SMTP."""
    msg = MIMEText(message)
    msg['Subject'] = 'Call Summary'
    msg['From'] = os.getenv('SMTP_USERNAME')
    msg['To'] = os.getenv('RECEIVING_EMAIL')

    with smtplib.SMTP_SSL(
        host=os.getenv('SMTP_HOST'),
        port=int(os.getenv('SMTP_PORT')),
        timeout=10
    ) as server:
        server.login(os.getenv('SMTP_USERNAME'), os.getenv('SMTP_PASSWORD'))
        server.send_message(msg)

    logger.info("Correo enviado")
