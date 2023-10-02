DENO_IMAGE = "denoland/deno:latest"
TOOLS_ARGS = '-e DENO_DIR=${WORKSPACE}/.deno --rm --volume /var/run/docker.sock:/var/run/docker.sock --volume /tmp:/tmp'
TOOLS_IMAGE = "${ECR}/develop/sts-tools:latest"

pipeline {
  agent none
  triggers {
    pollSCM( '* * * * *')
  }

  options {
    timeout(time: 1, unit: 'HOURS')
    disableConcurrentBuilds()
    parallelsAlwaysFailFast()
  }

  stages {
    parallel {

      stage('Lint & Format'){
        agent {
          docker {
            image DENO_IMAGE
            args TOOLS_ARGS
            label "small"
          }
        }
        steps {

          sh '''\
              #!/bin/bash

              echo "Remove old test files"
              find test -name ".*.json" -exec rm {} \\;
              
              deno lint src

              deno fmt --check src test
          '''.stripIndent()
        }
      }

      stage('Test') {
        agent {
          docker {
            image DENO_IMAGE
            args TOOLS_ARGS
            label 'large'
          }
        }
        steps {

          sh '''\
            #!/bin/bash

            deno test --coverage=.coverage --reporter junit --allow-read --allow-write test/* > .test.xml

            deno coverage .coverage --lcov --output=.coverage.lcov                      
          '''.stripIndent()
        }
        post {
          always {
            junit '.test.xml'
            stash(name: "coverage", includes: ".coverage.lcov")
          }
        }
      }
    }

    stage('Coverage') {
      agent {
        docker {
          image TOOLS_IMAGE
          args TOOLS_ARGS
          label 'small'
        }
      }
      steps {

        sh '''\
            #!/bin/bash

            # Convert LCOV to Cobertura XML
            lcov_cobertura -b . -o coverage.xml .coverage.lcov            
        '''.stripIndent()

        // Publish Cobertura report
        cobertura coberturaReportFile: 'coverage.xml'
      }
    }
  }
}
