# Implementation Plan — Deploying `mern-blog` to AWS EKS

**Goal:** a publicly reachable URL serving this blog app from a Kubernetes cluster on AWS, plus the source code on GitHub.

**Deliverables at the end:**

1. A live link (an AWS Load Balancer hostname) where the blog is usable — create/edit/delete posts.
2. A GitHub repository containing this code plus all Docker and Kubernetes config.

---

## 0. Facts about this codebase (read this first)

These were confirmed by reading the actual source. They differ from what generic EKS tutorials assume, and getting them wrong is the most common way this project stalls.

| Fact | Where | Why it matters |
|---|---|---|
| Frontend is **Vite**, not Create React App | `client/vite.config.js` | Build output is `client/dist/`, **not** `client/build/`. The Dockerfile must copy `dist`. |
| API base URL is **relative** (`baseURL: '/api'`) | `client/src/api.js` | No frontend code changes needed. nginx can proxy `/api` in production exactly like Vite's dev proxy does now. |
| Env var is **`MONGODB_URI`** | `server/server.js` | Most tutorials use `MONGO_URI`. The Kubernetes Secret key must be `MONGODB_URI` or the backend silently falls back to `localhost` and crashes. |
| Backend entry is `server.js`, start script is `node server.js` | `server/package.json` | Dockerfile `CMD` is `["node", "server.js"]`. |
| `GET /` returns `"MERN blog API is running"` | `server/server.js` | Free health-check endpoint — use it for Kubernetes readiness/liveness probes. |
| React Router is in use | `client/package.json` | nginx needs `try_files $uri /index.html` or refreshing `/posts/123` returns 404. |
| CORS is already enabled | `server/server.js` | Nothing to configure. |
| `package-lock.json` exists in both folders | — | `npm ci` works in the Dockerfiles (faster and more reproducible than `npm install`). |
| **Not a git repository yet** | — | GitHub setup starts from `git init`. |
| `.gitignore` already covers `node_modules/`, `.env`, `dist/` | `.gitignore` | Good. `server/.env` will not leak — but verify before pushing. |
| A `server/.claude/` folder exists | — | Harmless. Commit or ignore, your choice. |

### Architecture

```
Browser
   |
   v
AWS Load Balancer  (public — this is your "live link")
   |
   v
frontend-service (LoadBalancer, :80)
   |
   v
frontend pods  [nginx serving client/dist + proxying /api]
   |
   |  /api/*  -->  backend-service (ClusterIP, :5000)
   |                    |
   |                    v
   |               backend pods  [node server.js]
   |                    |
   v                    v
static files      MongoDB Atlas (managed, outside the cluster)
```

**Why MongoDB Atlas instead of running Mongo in the cluster:** self-hosting a database in Kubernetes means StatefulSets, PersistentVolumes, and backup strategy — a whole project on its own. Atlas's free tier keeps the focus on EKS and Kubernetes.

### Cost model

Billing starts at **Stage E**, not before. Stages A–D are free.

| Item | Rate |
|---|---|
| EKS control plane | ~$0.10/hour |
| 2 × t3.medium nodes | ~$0.08/hour |
| Load Balancer | ~$0.025/hour |
| **Total** | **~$0.21/hour** |

Completed in one sitting (~3 hours of billed time): **under $1**. Left running for a month by accident: **~$150**. Stage G is not optional.

---

## Stage A — Git and GitHub (free, ~20 min)

Do this first. It's a deliverable, it costs nothing, and it gives you a rollback point.

### A1. Verify secrets won't be committed

```bash
cd path/to/mern-blog
cat .gitignore
```

Confirm it contains `node_modules/`, `.env`, and `dist/`. It does — but check anyway.

### A2. Initialize the repository

```bash
git init
git add .
git status
```

**Stop and read the `git status` output.** If you see `server/.env` listed, do not continue — it contains your database credentials. Fix `.gitignore` first, then run `git rm --cached server/.env`.

### A3. First commit

```bash
git commit -m "Initial commit: MERN blog app"
```

### A4. Create the GitHub repository

1. Go to github.com, click **+** (top right) → **New repository**.
2. Name: `mern-blog` (or your choice).
3. Public or Private — either works.
4. **Do not** check "Add a README", "Add .gitignore", or "Choose a license" — you already have local files, and these create conflicts.
5. Click **Create repository**.

### A5. Push

```bash
git remote add origin https://github.com/<your-username>/mern-blog.git
git branch -M main
git push -u origin main
```

**Checkpoint:** refresh the GitHub page. You should see `client/`, `server/`, and `README.md` — and **no** `node_modules` or `.env`.

---

## Stage B — Dockerize and test locally (free, ~45 min)

Everything here runs on your machine. Any bug found now is free to fix; the same bug found in Stage F costs money and takes 10x longer to diagnose.

### B1. `server/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 5000
ENV NODE_ENV=production

CMD ["node", "server.js"]
```

`npm ci --omit=dev` skips `nodemon`, which is only needed for local development.

### B2. `server/.dockerignore`

```
node_modules
.env
.claude
npm-debug.log
```

Excluding `.env` matters: without it, your local credentials get baked into the image, and the image would override the Kubernetes Secret later.

### B3. `client/Dockerfile`

Two stages — build with Node, then serve the static output with nginx. The final image contains no Node.js and is ~25 MB instead of ~400 MB.

```dockerfile
# Stage 1: build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Note `/app/dist` — Vite's output directory.

### B4. `client/.dockerignore`

```
node_modules
dist
npm-debug.log
```

### B5. `client/nginx.conf`

```nginx
server {
    listen 80;

    # React Router: serve index.html for any unmatched path
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Forward API calls to the backend Service
    location /api/ {
        proxy_pass http://backend-service:5000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

`backend-service` is the Kubernetes Service name from Stage F — Kubernetes DNS resolves it inside the cluster.

### B6. Build both images

```bash
docker build -t mern-blog-server ./server
docker build -t mern-blog-client ./client
```

### B7. Test locally

The nginx config points at `backend-service`, which doesn't exist on your laptop. Create a Docker network so the containers can find each other, and give the backend that exact name:

```bash
docker network create blognet

docker run -d --name backend-service --network blognet \
  -e MONGODB_URI="<your Atlas connection string from Stage C>" \
  -e PORT=5000 \
  mern-blog-server

docker run -d --name frontend --network blognet -p 8080:80 mern-blog-client
```

> Stage C produces the Atlas connection string. If you'd rather test now, do Stage C first — it's free and takes 15 minutes. To test against a local MongoDB instead, use `-e MONGODB_URI="mongodb://host.docker.internal:27017/mern-blog"`.

Open **http://localhost:8080**. Create a post, edit it, delete it, and refresh the page on a post detail URL (tests React Router + `try_files`).

### B8. Clean up local containers

```bash
docker rm -f backend-service frontend
docker network rm blognet
```

### B9. Commit

```bash
git add .
git commit -m "Add Docker configuration for client and server"
git push
```

**Checkpoint:** the blog works fully at `localhost:8080` from containers only. Do not proceed until this passes.

---

## Stage C — MongoDB Atlas (free, ~15 min)

### C1. Create the cluster

1. Sign up at mongodb.com/cloud/atlas.
2. Choose the **M0 Free** tier (512 MB, free indefinitely, no card required).
3. Provider: **AWS**. Region: pick the same one you'll use for EKS (e.g. `us-east-1`) to reduce latency.
4. Name it `mern-blog-cluster` → **Create**.

### C2. Create a database user

Under **Security Quickstart**, set a username and a strong password. **Write both down** — the password appears in your connection string and can't be retrieved later.

> If your password contains `@`, `:`, `/`, or `#`, URL-encode it in the connection string (`@` → `%40`) or connection fails with a confusing parse error. Simplest fix: use a long alphanumeric password.

### C3. Network access

Add **`0.0.0.0/0`** (allow from anywhere).

Your EKS pods get dynamic outbound IPs, so IP allowlisting isn't practical here. Access still requires valid credentials. In production you'd use a NAT Gateway with a static IP, or VPC peering — out of scope for this project, but worth knowing that this is the shortcut.

### C4. Get the connection string

**Connect** → **Drivers** → copy the string. Then edit it:

- Replace `<password>` with the real password.
- Insert the database name before the `?`:

```
mongodb+srv://blogadmin:YourPassword@cluster0.xxxxx.mongodb.net/mern-blog?retryWrites=true&w=majority
                                                                  ^^^^^^^^^
```

Without the database name, Mongoose writes to a database called `test`.

**Checkpoint:** save this string somewhere safe. Go back and finish B7 with it if you skipped ahead.

---

## Stage D — AWS foundation (free, ~30 min)

### D1. Budget alert (do this before anything else)

1. AWS Console → search **Budgets** → **Create budget**.
2. **Use a template** → **Monthly cost budget**.
3. Amount: `$20`. Email: your address.
4. **Create budget**.

This doesn't cap spending — it emails you when you cross a threshold. It's the cheapest insurance available while learning.

### D2. Create an IAM user

Using your root account for daily work is the single most common AWS security mistake.

1. Console → **IAM** → **Users** → **Create user**.
2. Name: `mern-deploy-user`.
3. **Attach policies directly** → check **AdministratorAccess**.
   - Broad, but appropriate for a learning project. Production would scope this to specific EKS/ECR/EC2 actions.
4. Create the user, open it → **Security credentials** tab.
5. **Access keys** → **Create access key** → **Command Line Interface (CLI)** → acknowledge → **Create**.
6. Copy the **Access Key ID** and **Secret Access Key**. The secret is shown exactly once.

### D3. Install the tools

| Tool | macOS | Windows | Linux |
|---|---|---|---|
| AWS CLI v2 | `brew install awscli` | MSI from AWS docs | `curl` + `sudo ./aws/install` |
| kubectl | `brew install kubectl` | `choco install kubernetes-cli` | official install docs |
| eksctl | `brew install eksctl` | `choco install eksctl` | download tarball → `/usr/local/bin` |
| Docker Desktop | docker.com | docker.com | `apt install docker.io` |

Verify all four:

```bash
aws --version        # expect aws-cli/2.x
kubectl version --client
eksctl version       # must be 0.215.0 or newer
docker --version
```

### D4. Configure the CLI

```bash
aws configure
```

Enter your Access Key ID, Secret Access Key, region (`us-east-1`), and output format (`json`).

### D5. Verify and record your Account ID

```bash
aws sts get-caller-identity
```

Note the 12-digit **Account** number — every ECR image URL below needs it.

**Checkpoint:** all four tools report versions, and `get-caller-identity` returns your account.

---

## Stage E — ECR and EKS (**billing starts here**, ~45 min)

Set aside an uninterrupted block. `eksctl create cluster` takes 15–20 minutes of waiting.

Throughout this stage, replace `<ACCOUNT_ID>` with your 12-digit ID and `us-east-1` with your region.

### E1. Create two ECR repositories

```bash
aws ecr create-repository --repository-name mern-blog-server --region us-east-1
aws ecr create-repository --repository-name mern-blog-client --region us-east-1
```

### E2. Authenticate Docker with ECR

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
```

This token expires after 12 hours. If a push later fails with `no basic auth credentials`, re-run this command.

### E3. Tag and push both images

```bash
# Backend
docker tag mern-blog-server:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mern-blog-server:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mern-blog-server:latest

# Frontend
docker tag mern-blog-client:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mern-blog-client:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mern-blog-client:latest
```

Verify in the Console: **ECR** → each repository should show an image tagged `latest`.

### E4. Create the EKS cluster

```bash
eksctl create cluster \
  --name mern-blog-cluster \
  --region us-east-1 \
  --nodegroup-name mern-nodes \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 3 \
  --managed
```

What this single command provisions:

- A dedicated **VPC** with public and private subnets across availability zones
- The **EKS control plane** (the managed Kubernetes API server)
- **IAM roles** for the cluster and the nodes
- A **managed node group**: 2 × t3.medium EC2 instances that will run your pods
- Your local **kubeconfig** (`~/.kube/config`), so `kubectl` immediately knows how to reach the cluster

15–20 minutes is normal. It's building CloudFormation stacks; watch the progress lines.

### E5. Verify

```bash
kubectl get nodes
```

Expect 2 nodes with `STATUS: Ready`. If `kubectl` can't connect:

```bash
aws eks update-kubeconfig --name mern-blog-cluster --region us-east-1
```

**Checkpoint:** two Ready nodes. The meter is now running.

---

## Stage F — Deploy to Kubernetes (~20 min)

### F1. Create the Secret

Create it via CLI, never in a committed YAML file — a Kubernetes Secret is only base64-encoded, not encrypted, so committing one leaks your database password.

```bash
kubectl create secret generic mongo-secret \
  --from-literal=MONGODB_URI='mongodb+srv://blogadmin:YourPassword@cluster0.xxxxx.mongodb.net/mern-blog?retryWrites=true&w=majority'
```

Single quotes matter — the string contains `&`, which your shell would otherwise interpret.

The key **must** be `MONGODB_URI`, matching `server/server.js`.

### F2. `k8s/backend-deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mern-blog-server:latest
          ports:
            - containerPort: 5000
          env:
            - name: PORT
              value: "5000"
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: mongo-secret
                  key: MONGODB_URI
          readinessProbe:
            httpGet:
              path: /
              port: 5000
            initialDelaySeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 5000
            initialDelaySeconds: 20
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

The probes use the `GET /` route that already exists in `server.js`. **Readiness** controls whether a pod receives traffic; **liveness** restarts a pod that has hung.

### F3. `k8s/backend-service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  selector:
    app: backend
  ports:
    - port: 5000
      targetPort: 5000
  type: ClusterIP
```

`ClusterIP` = internal only. The name `backend-service` is exactly what `nginx.conf` proxies to.

### F4. `k8s/frontend-deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mern-blog-client:latest
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
```

### F5. `k8s/frontend-service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
  type: LoadBalancer
```

`LoadBalancer` tells AWS to provision a real load balancer with a public DNS name. **This is what produces your live link.**

### F6. Apply — backend first

Order matters. nginx resolves `backend-service` when it starts; if the Service doesn't exist yet, the frontend pods crash with `host not found in upstream`.

```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml

kubectl get pods -w
# wait for backend pods to reach READY 1/1, then Ctrl+C

kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml
```

### F7. Get your live link

```bash
kubectl get svc frontend-service
```

`EXTERNAL-IP` shows `<pending>` for 2–4 minutes while AWS provisions the load balancer. Re-run until a hostname appears:

```
a1b2c3d4e5f6g7h8.us-east-1.elb.amazonaws.com
```

Open `http://<that-hostname>` in a browser. **That is your deliverable.**

> Use `http://`, not `https://` — no TLS certificate is configured. HTTPS would require ACM plus an Ingress, which is a reasonable follow-up but out of scope here.

DNS propagation can add another minute or two after the hostname appears. If you get a connection error immediately, wait and retry before debugging.

### F8. Verify end to end

Create a post, edit it, delete it, then refresh on a detail page. Confirm data persists by checking **Browse Collections** in the Atlas UI — you should see your `mern-blog` database with a `posts` collection.

### F9. Commit the manifests

```bash
git add k8s/
git commit -m "Add Kubernetes manifests for EKS deployment"
git push
```

**Checkpoint:** a working public URL, and the code is on GitHub.

---

## Stage G — Capture evidence, then tear down

**Do this the same day.** An idle cluster bills ~$5/day.

### G1. Capture proof before deleting

Once the cluster is gone, the link dies. Save:

- A screenshot of the blog running at the ELB URL, with the address bar visible
- Terminal output of `kubectl get pods`, `kubectl get svc`, and `kubectl get nodes`
- The ELB hostname itself, written into your README

Consider adding a short "Deployment" section to `README.md` with the architecture diagram and these screenshots — that's what makes this legible to anyone reviewing the project later.

### G2. Delete Kubernetes resources first

```bash
kubectl delete -f k8s/
```

This deletes the `LoadBalancer` Service, which triggers AWS to deprovision the ELB. Skipping this step can orphan the load balancer — `eksctl` doesn't know about resources Kubernetes created, so it keeps billing after the cluster is gone.

Confirm it's going away:

```bash
kubectl get svc
```

### G3. Delete the cluster

```bash
eksctl delete cluster --name mern-blog-cluster --region us-east-1
```

Takes 5–10 minutes. It removes the node group, control plane, VPC, and IAM roles it created.

### G4. Verify nothing is left billing

Check each in the Console, **in your region**:

- [ ] **EC2 → Instances** — no running `mern-nodes` instances
- [ ] **EC2 → Load Balancers** — none remaining
- [ ] **EKS → Clusters** — `mern-blog-cluster` gone
- [ ] **VPC** — the cluster's VPC deleted
- [ ] **CloudFormation** — no leftover `eksctl-mern-blog-cluster-*` stacks

Safe to keep: **ECR images** (a few cents per month, useful if you redeploy) and the **Atlas M0 cluster** (free indefinitely).

Check **Billing → Cost Explorer** the next day to confirm charges stopped.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ImagePullBackOff` | Wrong image URL, or the image was never pushed. Verify the account ID, region, and repo name character by character; confirm the tag exists in the ECR console. |
| `CrashLoopBackOff` on backend | Almost always the database connection. `kubectl logs deployment/backend-deployment` — if it says `MongoDB connection error`, the Secret is wrong. |
| Backend logs show `connect ECONNREFUSED 127.0.0.1:27017` | `MONGODB_URI` isn't reaching the container — it fell back to the localhost default. Check the Secret key is spelled `MONGODB_URI`, not `MONGO_URI`. |
| Frontend `CrashLoopBackOff`, logs say `host not found in upstream "backend-service"` | The frontend started before `backend-service` existed. Apply the backend Service, then `kubectl rollout restart deployment/frontend-deployment`. |
| `EXTERNAL-IP` stuck on `<pending>` past 5 minutes | Usually IAM permissions for creating load balancers. `kubectl describe svc frontend-service` and read the Events section. |
| Site loads but API calls 404 | nginx `/api/` proxy path. Confirm `proxy_pass` ends with `/api/` and that the app calls `/api/posts`. |
| Refreshing a post URL gives 404 | `try_files $uri $uri/ /index.html` missing from `nginx.conf`. |
| Blank white page | Vite build output path. Confirm the Dockerfile copies from `/app/dist`, not `/app/build`. |
| `kubectl` says `Unable to connect to the server` | `aws eks update-kubeconfig --name mern-blog-cluster --region us-east-1` |
| `docker push` → `no basic auth credentials` | ECR token expired (12 hours). Re-run the E2 login command. |
| Atlas connection times out | Network Access list is missing `0.0.0.0/0`. |

### Debugging commands worth memorizing

```bash
kubectl get pods                              # what's running
kubectl logs <pod-name>                       # application output
kubectl logs <pod-name> --previous            # logs from a crashed container
kubectl describe pod <pod-name>               # Events section explains scheduling/pull failures
kubectl get events --sort-by='.lastTimestamp' # cluster-wide recent activity
kubectl exec -it <pod-name> -- sh             # shell inside a container
```

`kubectl describe pod` is the highest-value command here — the Events list at the bottom explains most failures directly.

---

## Time estimate

| Stage | Duration | Cost |
|---|---|---|
| A — GitHub | 20 min | free |
| B — Dockerize + local test | 45 min | free |
| C — MongoDB Atlas | 15 min | free |
| D — AWS foundation | 30 min | free |
| E — ECR + EKS | 45 min | billing starts |
| F — Deploy | 20 min | billing |
| G — Evidence + teardown | 20 min | billing stops |
| **Total** | **~3.5 hours** | **~$1** |

Stages A–D can be done on a different day than E–G. Only E, F, and G need to be one continuous block.

---

## What this project demonstrates

- Containerizing a multi-service application, including multi-stage builds that keep production images small
- Private container registries (ECR) and the tag/push workflow
- IAM users, access keys, and least-privilege reasoning
- Managed Kubernetes (EKS) provisioning with `eksctl`
- Core Kubernetes objects: Deployments, Services (ClusterIP vs LoadBalancer), Secrets, and health probes
- Service discovery via cluster DNS (nginx reaching `backend-service` by name)
- Diagnosing failures from pod logs and events
- Cloud cost awareness and responsible resource cleanup

---

## Possible follow-ups

Each is a natural next project rather than part of this one:

1. **HTTPS** — AWS Certificate Manager + an ALB Ingress Controller instead of a raw LoadBalancer Service.
2. **CI/CD** — GitHub Actions that builds, pushes to ECR, and runs `kubectl set image` on every push to `main`.
3. **Horizontal Pod Autoscaler** — scale pods on CPU usage (your resource requests are already defined, which HPA requires).
4. **Helm** — package these manifests as a chart with environment-specific values.
5. **Observability** — CloudWatch Container Insights, or Prometheus and Grafana in-cluster.
