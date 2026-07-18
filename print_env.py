import os
with open("env_output.txt", "w") as f:
    for k, v in os.environ.items():
        f.write(f"{k}={v}\n")
print("Done")
