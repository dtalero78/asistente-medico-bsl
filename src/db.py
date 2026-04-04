import os
import logging
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

db_pool = ConnectionPool(
    conninfo=f"host={os.getenv('DB_HOST')} port={os.getenv('DB_PORT')} dbname={os.getenv('DB_NAME')} user={os.getenv('DB_USER')} password={os.getenv('DB_PASSWORD')} sslmode=require",
    min_size=2,
    max_size=10,
)

logger.info("Pool de conexiones PostgreSQL inicializado")
