# api/init_db.py
from db import engine
from models import Base

if __name__ == "__main__":
    print("Dropping tables for current metadata (jobs)...")
    Base.metadata.drop_all(bind=engine)
    print("Creating tables for current metadata (jobs)...")
    Base.metadata.create_all(bind=engine)
    print("Done.")

