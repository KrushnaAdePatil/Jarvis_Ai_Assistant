import subprocess
out = subprocess.run(['git', 'push', 'origin', 'main'], capture_output=True)
with open("real_error.txt", "w", encoding="utf-8") as f:
    f.write(out.stderr.decode("utf-8", "ignore").replace("\r", ""))
