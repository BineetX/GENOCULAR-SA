import os
from rq import Queue
from redis import Redis

def get_queue() -> Queue:
    r = Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
    return Queue(os.getenv("RQ_QUEUE", "default"), connection=r)

def submit_job(job_id: str, r1: str, r2: str, sample: str = "") -> str:
    q = get_queue()
    job = q.enqueue(
        "tasks.run_job",
        job_id=job_id,
        r1=r1,
        r2=r2,
        sample=sample,
        job_timeout=24*3600,
        result_ttl=7*24*3600,
    )
    return job.id

