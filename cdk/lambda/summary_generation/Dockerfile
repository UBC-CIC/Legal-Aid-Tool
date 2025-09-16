FROM public.ecr.aws/lambda/python:3.12

# Install system dependencies for psycopg[binary] and build tools for numpy
RUN dnf -y install postgresql-devel gcc libpq-devel gcc-c++ \
    && dnf clean all

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy the requirements files
COPY requirements.in ${LAMBDA_TASK_ROOT}

# Install Python packages
RUN pip install --no-cache-dir -r requirements.in

# Show installed packages ( for debugging)
RUN pip list

# Copy source code
COPY src/ ${LAMBDA_TASK_ROOT}

# Set Lambda handler
CMD [ "main.handler" ]