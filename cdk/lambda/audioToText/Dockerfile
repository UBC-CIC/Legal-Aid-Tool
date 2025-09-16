FROM public.ecr.aws/lambda/python:3.12

# Install system dependencies
RUN dnf -y install postgresql-devel gcc libpq-devel gcc-c++ \
    && dnf clean all

# Copy the requirements.txt (pinned dependencies)
COPY requirements.txt ${LAMBDA_TASK_ROOT}

# Install Python packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy the source code
COPY src/ ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler
CMD [ "main.handler" ]
