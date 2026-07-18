import os
import json
import urllib.request

# Load token and username
try:
    with open("github_token.txt", "r") as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
        token = lines[0]
        username = lines[1]
except Exception as e:
    print("ERROR loading credentials:", e)
    exit(1)

repo_name = "solana-alpha-scanner"

def github_request(url, method="GET", data=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "Solana-Scanner-Cleanup")
    if data is not None:
        req.add_header("Content-Type", "application/json")
        data_bytes = json.dumps(data).encode("utf-8")
    else:
        data_bytes = None
    try:
        with urllib.request.urlopen(req, data=data_bytes) as res:
            return json.loads(res.read().decode("utf-8")), res.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return json.loads(body), e.code
        except:
            return {"message": body}, e.code
    except Exception as e:
        return {"message": str(e)}, 500

files_to_delete = [
    "Dockerfile",
    "package.json",
    "backend/server.js",
    "backend/db.js",
    ".github/workflows/build-backend.yml"
]

print("Starting remote cleanup...")
for path in files_to_delete:
    url = f"https://api.github.com/repos/{username}/{repo_name}/contents/{path}"
    
    # 1. Get file SHA
    res, code = github_request(url)
    if code == 200:
        sha = res.get("sha")
        print(f"Found {path} (sha: {sha}). Deleting...")
        
        # 2. Delete file
        delete_data = {
            "message": f"Delete {path} to restore pure client-side SWA",
            "sha": sha,
            "branch": "main"
        }
        del_res, del_code = github_request(url, method="DELETE", data=delete_data)
        if del_code in [200, 201]:
            print(f"Deleted {path} successfully!")
        else:
            print(f"Failed to delete {path}: {del_res.get('message')}")
    else:
        print(f"File {path} not found on GitHub (code {code}), skipping.")

print("Cleanup complete!")
