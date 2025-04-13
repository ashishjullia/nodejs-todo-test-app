# Simple Todo Node.js App with PostgreSQL and AWS ECS Deployment

This is a basic Todo list application built with Node.js, Express, and PostgreSQL. It demonstrates CRUD operations for todos, simple password-based authentication, and includes configurations for local development using Docker Compose and deployment to AWS ECS (Fargate) via GitHub Actions.

## Features

* **Create & View Todos:** Add new todo items and view the list of existing todos.
* **Basic Authentication:** Simple password protection using express-session.
* **Database:** Uses PostgreSQL to store todo items.
* **AWS IAM Authentication:** Connects to AWS RDS PostgreSQL using IAM database authentication for enhanced security.
* **Dockerized:** Includes `Dockerfile.dev` and `docker-compose.yml` for easy local development setup.
* **AWS ECS Deployment:** Configured for deployment to AWS ECS Fargate using an included task definition.
* **CI/CD Pipeline:** Includes a GitHub Actions workflow (`.github/workflows/deploy-dev.yml`) for automated deployment to a development environment on AWS upon pushes to the `main` branch or `dev-*` tags.

## Technology Stack

* **Backend:** Node.js, Express.js
* **Database:** PostgreSQL
* **Authentication:** `express-session`
* **AWS:**
    * RDS (for PostgreSQL)
    * ECS (Fargate) for container orchestration
    * ECR (Elastic Container Registry) for Docker image storage
    * Secrets Manager for storing database credentials
    * IAM (for database authentication and deployment roles)
* **Containerization:** Docker, Docker Compose
* **CI/CD:** GitHub Actions

## Local Development Setup

### Prerequisites

* Docker and Docker Compose installed.
* Node.js and npm (optional, for direct interaction if not using Docker exclusively).

### Steps

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd example-sample-nodejs-todo-app
    ```
2.  **Configure Environment (if needed):**
    The `docker-compose.yml` sets up environment variables for the database connection. For local development, it uses predefined credentials (`todouser`/`todopassword`) for the PostgreSQL container.
    ```yaml
    # docker-compose.yml excerpt
    environment:
      - NODE_ENV=development
      - PORT=80
      - DATABASE_URL=postgresql://todouser:todopassword@db:5432/tododb
      # For AWS IAM Auth testing locally, you would need AWS credentials
      # and potentially adjust server.js to read local env vars instead of ECS secrets
      # - RDS_HOSTNAME=...
      # - RDS_PORT=5432
      # - RDS_IAM_USER=...
      # - RDS_DB_NAME=...
      # - AWS_REGION=...
      - APP_PASSWORD=example # Set your desired login password here
    ```
3.  **Build and Run Containers:**
    ```bash
    docker-compose up --build
    ```
    This command will:
    * Build the Node.js application image using `Dockerfile.dev`.
    * Start the Node.js application container (`todo-node-app`).
    * Start a PostgreSQL container (`todo-postgres-db`).
    * Create a volume (`db-data`) for persistent database storage.

4.  **Access the Application:**
    Open your web browser and navigate to `http://localhost:80` (or the port mapped in `docker-compose.yml`). You should see the login page. Use the password defined by `APP_PASSWORD` (default: "example") to log in.

## Application Structure

* **`server.js`**: The main entry point for the Express application. Handles server setup, database connection (including IAM authentication logic), middleware, routing, and API endpoints.
* **`package.json` / `package-lock.json`**: Define project dependencies and scripts.
* **`public/`**: Contains static frontend files.
    * `index.html`: The main page for displaying and adding todos.
    * `login.html`: The login page.
* **`Dockerfile.dev`**: (Referenced in `docker-compose.yml`) Defines the Docker image build process for development.
* **`docker-compose.yml`**: Defines the services, networks, and volumes for the local Docker development environment.
* **`ecs-task-definitions/`**: Contains ECS task definition JSON files.
    * `task-definition-dev.json`: Defines the task configuration for the development environment on ECS Fargate.
* **`.github/workflows/`**: Contains GitHub Actions workflows.
    * `deploy-dev.yml`: Defines the CI/CD pipeline for deploying to the development environment.

## API Endpoints (Authenticated)

* **`GET /api/todos`**: Fetches all existing todo items, ordered by creation date descending.
* **`POST /add-todo`**: Adds a new todo item. Expects JSON body: `{ "todoText": "Your todo item" }`.
* **`GET /health`**: Health check endpoint to verify database connectivity.
* **`GET /login`**: Serves the login page.
* **`POST /login`**: Handles login attempts. Expects form data with `password`.
* **`GET /logout`**: Destroys the user session and redirects to login.

## Deployment (Development Environment)

The deployment to the development AWS environment is automated via the `.github/workflows/deploy-dev.yml` GitHub Actions workflow.

**Workflow Summary:**

1.  **Trigger:** Runs on push to the `main` branch or when a tag matching `dev-*` is pushed (ignores changes to `README.md`).
2.  **Environment Variables:** Sets up necessary variables for AWS regions, ECR/ECS names, IAM roles, and Secrets Manager ARN.
3.  **AWS Credentials:** Configures AWS credentials using OIDC (assuming a GitHub OIDC provider is set up in AWS IAM) and assumes the specified `DEPLOY_ROLE`.
4.  **Update Secrets Manager:** Constructs a JSON payload with RDS details (hostname, port, IAM user, DB name, region) retrieved from GitHub Secrets (`secrets.RDS_HOSTNAME`, etc.) and updates the specified AWS Secrets Manager secret (`RDS_DETAILS_TODO_APP_SECRETS`). **Note:** This implies RDS connection details are stored as GitHub repository/organization secrets.
5.  **Login to ECR:** Authenticates the Docker client to Amazon ECR.
6.  **Build & Push Image:** Builds the Docker image using the repository's context (`Dockerfile`), tags it with the Git SHA, and pushes it to the specified ECR repository (`ECR_REPO`). Uses Docker Buildx for potential caching (`cache-from: type=gha`, `cache-to: type=gha,mode=max`).
7.  **Update Task Definition:** Takes the `ecs-task-definitions/task-definition-dev.json` file, replaces the image placeholder with the newly built ECR image URI, creating a new task definition revision.
8.  **Deploy to ECS:** Deploys the new task definition revision to the specified ECS service (`ECS_SERVICE_NAME`) and cluster (`ECS_CLUSTER_NAME`), forcing a new deployment.
9.  **Update Service Count:** Sets the desired count of the ECS service to 1, ensuring the service runs at least one task.

**Key AWS Resources Used (Implied by Workflow & Task Definition):**

* **IAM:**
    * `DEPLOY_ROLE`: Assumed by GitHub Actions for deployment permissions.
    * `iam_role_for_ecs_task_role`: Task Role providing permissions to the running container (e.g., permissions to access Secrets Manager for RDS details and potentially call other AWS services).
    * `iam_role_for_ecs_execution_role`: Execution Role granting ECS agent permissions to pull the ECR image and publish logs.
    * `RDS_IAM_USER`: The IAM user the application uses to authenticate with the RDS database.
* **ECR:** `sample-todo-nodejs-pgsql-app` repository.
* **ECS:**
    * `dev-cluster-1` cluster.
    * `sample-ecs-service-nodejs` service.
    * `sample-ecs-task-definition-nodejs` task definition family.
* **Secrets Manager:** `arn:aws:secretsmanager:ap-south-1:254319123211:secret:nodejs-todo-app-v3-8kwXqP` used to store RDS connection details.
* **CloudWatch Logs:** `/ecs/ecs_nodejs_container` log group for container logs.

## Configuration

* **Local:** Primarily configured via environment variables in `docker-compose.yml`.
* **AWS Deployment:**
    * Database connection details (`RDS_HOSTNAME`, `RDS_PORT`, `RDS_IAM_USER`, `RDS_DB_NAME`, `AWS_REGION`) are injected into the container environment from AWS Secrets Manager, as defined in the ECS task definition (`task-definition-dev.json`).
    * The GitHub Actions workflow updates these secrets in Secrets Manager before deployment, using values stored in GitHub Secrets.
    * The application login password (`APP_PASSWORD`) should ideally be managed securely (e.g., via Secrets Manager or environment variables) in a production scenario, rather than relying solely on the default or a Docker Compose setting. The current `server.js` reads it from `process.env.APP_PASSWORD` or defaults to "example".
    * Session secret (`SESSION_SECRET`) is read from `process.env.SESSION_SECRET` or defaults to an insecure value. Ensure this is set securely in a deployed environment.

## Authentication

* The application uses a simple session-based authentication mechanism.
* Access to the main todo page (`/`) and API endpoints requires logging in via the `/login` page.
* Login requires the password defined by the `APP_PASSWORD` environment variable.
* Database authentication uses AWS IAM credentials generated dynamically via the `@aws-sdk/rds-signer` package.
