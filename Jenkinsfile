TOOLS_IMAGE = "denoland/deno:latest"
TOOLS_ARGS = '-e DENO_DIR=${WORKSPACE}/.deno --rm --volume /var/run/docker.sock:/var/run/docker.sock --volume /tmp:/tmp'

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
            image TOOLS_IMAGE
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
            image TOOLS_IMAGE
            args TOOLS_ARGS
            label 'large'
            alwaysPull true
          }
        }
        steps {

          sh '''\
              #!/bin/bash

              deno test --coverage=.coverage --reporter junit --allow-read --allow-write test/* > .test.xml

              deno coverage .coverage --lcov --output=.coverage.lcov
              env
              ls -l /usr/local/bin/
              # Convert LCOV to Cobertura XML
              /usr/local/bin/lcov_cobertura -b . -o coverage.xml .coverage.lcov            
          '''.stripIndent()

          // Publish Cobertura report
          cobertura coberturaReportFile: 'coverage.xml'
        }
        post {
          always {
            junit '.test.xml'

            // sh '''\
            //     #!/bin/bash
            //     deno coverage .coverage --lcov --output=.coverage.lcov

            //     # Convert LCOV to Cobertura XML
            //     lcov_cobertura -b . -o coverage.xml .coverage.lcov
            // '''.stripIndent()

            // // Publish Cobertura report
            // cobertura coberturaReportFile: 'coverage.xml'
          }
        }
      }
    }
  }
}
