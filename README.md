# MERN Blog

A small blog app built with MongoDB, Express, React (Vite), and Node.

## Features

- List, create, edit, and delete blog posts
- No authentication — single-user, open access
- REST API backend + React frontend

## Structure

```
mern-blog/
  server/   Express + Mongoose API
  client/   React (Vite) frontend
```

## Prerequisites

- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string

## Setup

### 1. Backend

```
cd server
npm install
cp .env.example .env
# edit .env if your MongoDB URI differs from the default
npm run dev
```

Runs on http://localhost:5000.

### 2. Frontend

In a second terminal:

```
cd client
npm install
npm run dev
```

Runs on http://localhost:5173 and proxies `/api` requests to the backend.

Open http://localhost:5173 in your browser.

## API

| Method | Route            | Description        |
|--------|------------------|---------------------|
| GET    | /api/posts       | List all posts      |
| GET    | /api/posts/:id   | Get one post        |
| POST   | /api/posts       | Create a post        |
| PUT    | /api/posts/:id   | Update a post        |
| DELETE | /api/posts/:id   | Delete a post        |

## Notes

- If you don't have MongoDB installed locally, create a free cluster at MongoDB Atlas and paste the connection string into `server/.env` as `MONGODB_URI`.

---

# Cloud Deployment — AWS EKS

This app was containerized and deployed to a Kubernetes cluster on **Amazon EKS**, served publicly through an AWS Load Balancer.

> **Status:** the cluster was deleted after verification to avoid ongoing charges, so the live URL below is no longer active. See [Reproducing the deployment](#reproducing-the-deployment) to bring it back up.

**Live URL (while cluster was running):**
`http://ab7bad81dc99e4a8da33dd5dddd8c347-204035414.ap-south-1.elb.amazonaws.com`

**Region:** `ap-south-1` · **Cluster:** `mern-blog-cluster`

## Architecture

```
Browser
   |
   v
AWS Load Balancer  (public)
   |
   v
frontend-service (LoadBalancer, :80)
   |
   v
frontend pod  [nginx serving Vite build + proxying /api]
   |
   |  /api/*  -->  backend-service (ClusterIP, :5000)
   |                    |
   |                    v
   |               backend pod  [node server.js]
   |                    |
   v                    v
static files      MongoDB Atlas (managed, outside the cluster)
```

The React frontend is built by Vite and served as static files by nginx. Any request to `/api/*` is proxied in-cluster to `backend-service`, resolved by Kubernetes DNS — so the browser only ever talks to one origin and no CORS configuration is needed in production.

MongoDB runs on Atlas rather than inside the cluster, keeping the project focused on Kubernetes/EKS rather than on StatefulSets and persistent volume management.

## Infrastructure

| Component | Choice |
|---|---|
| Container registry | Amazon ECR (`mern-blog-server`, `mern-blog-client`) |
| Orchestration | Amazon EKS, Kubernetes v1.34 |
| Nodes | 3 × `t3.micro` (managed node group) |
| Frontend image | Multi-stage: `node:20-alpine` build → `nginx:1.27-alpine` |
| Backend image | `node:20-alpine` |
| Database | MongoDB Atlas (M0 free tier) |
| CI/CD | GitHub Actions → builds and pushes to ECR on every push to `main` |

### Why `t3.micro` and single replicas

The AWS account is on the Free Tier plan, which only permits free-tier-eligible instance types. `t3.micro` supports a maximum of **4 pods per node** under the AWS VPC CNI (a limit derived from available ENIs and IPs per interface). Across 3 nodes that's 12 pod slots, of which ~8 are consumed by system components (`aws-node` and `kube-proxy` DaemonSets on each node, plus 2 `coredns` replicas). Deployments therefore run 1 replica each, leaving headroom for rolling updates.

On a paid plan with larger instances, `replicas: 2` in both Deployment manifests is the sensible default.

## Kubernetes resources

| File | Resource | Purpose |
|---|---|---|
| `k8s/backend-deployment.yaml` | Deployment | Runs the Express API, with readiness/liveness probes on `GET /` |
| `k8s/backend-service.yaml` | Service (ClusterIP) | Internal-only address for the API |
| `k8s/frontend-deployment.yaml` | Deployment | Runs nginx serving the React build |
| `k8s/frontend-service.yaml` | Service (LoadBalancer) | Provisions the public AWS load balancer |
| `k8s/mongo-secret.example.yaml` | Secret (reference) | Shape only — the real secret is created via `kubectl`, never committed |

The database connection string is injected as an environment variable from a Kubernetes Secret, so no credentials appear in the manifests or in any image.

## Reproducing the deployment

Prerequisites: AWS CLI (configured), `kubectl`, `eksctl`, and a MongoDB Atlas connection string.

```bash
# 1. Create ECR repositories
aws ecr create-repository --repository-name mern-blog-server --region ap-south-1
aws ecr create-repository --repository-name mern-blog-client --region ap-south-1

# 2. Build and push images
#    Handled automatically by GitHub Actions on push to main.
#    Requires repo secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

# 3. Create the cluster (~15-20 min)
eksctl create cluster \
  --name mern-blog-cluster \
  --region ap-south-1 \
  --nodegroup-name mern-nodes-micro \
  --node-type t3.micro \
  --nodes 3 --nodes-min 1 --nodes-max 4 \
  --managed

# 4. Connect kubectl
aws eks update-kubeconfig --name mern-blog-cluster --region ap-south-1

# 5. Create the database secret (never commit this value)
kubectl create secret generic mongo-secret \
  --from-literal=MONGODB_URI='<your-atlas-connection-string>'

# 6. Deploy — backend first, so nginx can resolve backend-service on startup
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml
kubectl wait --for=condition=ready pod -l app=backend --timeout=120s

kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml

# 7. Get the public URL (EXTERNAL-IP takes 2-4 min to appear)
kubectl get svc frontend-service
```

### Teardown

```bash
kubectl delete -f k8s/                                          # removes the load balancer first
eksctl delete cluster --name mern-blog-cluster --region ap-south-1
```

Deleting the Kubernetes Services **before** the cluster matters: the load balancer is created by Kubernetes, not by `eksctl`, so deleting the cluster first can orphan it and leave it billing.

## Notes and known limitations

- **HTTP only.** No TLS certificate is configured. Adding HTTPS would mean AWS Certificate Manager plus an ALB Ingress Controller in place of the raw `LoadBalancer` Service.
- **Atlas network access is open to `0.0.0.0/0`.** EKS pods get dynamic outbound IPs, so IP allowlisting isn't practical without a NAT Gateway with a static IP. Access still requires valid credentials.
- **No Horizontal Pod Autoscaler.** Resource requests and limits are defined, so HPA would be a straightforward addition.

## Deployment troubleshooting

| Symptom | Cause |
|---|---|
| Node group stuck in `CREATING`, no health issues reported | Instance type not permitted on a Free Tier plan account — check ASG scaling activities for the real error |
| `kubectl` targets `localhost:8080` | Kubeconfig not written; run `aws eks update-kubeconfig` |
| Frontend pod: `host not found in upstream "backend-service"` | Frontend applied before the backend Service existed |
| Backend `CrashLoopBackOff` with `ECONNREFUSED 127.0.0.1:27017` | `MONGODB_URI` not reaching the container — check the Secret key spelling |
| Blank white page | Wrong build output path — Vite emits `dist/`, not `build/` |
