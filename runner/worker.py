# runner/worker.py
import os
from redis import Redis
from rq import Worker, Connection

def main():
    redis_url = os.getenv("REDIS_URL") or "redis://redis:6379/0"

    queue_name = (os.getenv("RQ_QUEUE") or "default").strip()


    conn = Redis.from_url(redis_url)

    print(f"[runner] starting rq worker | redis={redis_url} | queue={queue_name}", flush=True)

    with Connection(conn):
        w = Worker([queue_name])
        w.work(with_scheduler=True)

if __name__ == "__main__":
    main()
