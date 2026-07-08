"""
Media worker entry point. Blocking-pops media jobs off the Redis list the NestJS
API pushes to, and runs the processing pipeline for each. Scale horizontally by
running more worker processes/containers.
"""
import json
import logging
import redis

from .config import config
from .pipeline import process_route

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("worker")


def run():
    # no socket_timeout so blocking BRPOP doesn't raise; we still use a finite BRPOP
    # timeout and loop so the worker stays responsive and reconnects cleanly.
    r = redis.from_url(config.REDIS_URL, socket_timeout=None, socket_keepalive=True)
    log.info("RouteSync media worker started; waiting on %s", config.MEDIA_JOBS_KEY)
    while True:
        try:
            res = r.brpop([config.MEDIA_JOBS_KEY], timeout=5)
        except redis.exceptions.RedisError as e:
            log.warning("redis error, retrying: %s", e)
            continue
        if res is None:
            continue  # no job within the window; poll again
        _, raw = res
        try:
            job = json.loads(raw)
        except json.JSONDecodeError:
            log.error("bad job payload: %r", raw)
            continue

        if job.get("type") == "process_route":
            log.info("processing upload %s", job["uploadId"])
            process_route(job["uploadId"])
        else:
            log.warning("unknown job type: %s", job.get("type"))


if __name__ == "__main__":
    run()
