TOOLS_IMAGE = "denoland/deno:latest"
TOOLS_ARGS = '-e DENO_DIR=${WORKSPACE}/.deno --rm --volume /var/run/docker.sock:/var/run/docker.sock --volume /tmp:/tmp'

pipeline {
  agent {
    label 'ec2-large'
  }

  triggers {
    pollSCM( '* * * * *')
    cron( 'H H(2-3) * * H(2-4)') // UTC About Midday Sydney time on a workday.
  }

  options {
    timeout(time: 1, unit: 'HOURS')
    disableConcurrentBuilds()
    parallelsAlwaysFailFast()
  }

  stages {
    stage( 'init'){
       steps {
      sh '''\
      env
      mkdir -p .deno
      '''
       }
    }

    stage('Test') {
      agent {
        docker {
          image TOOLS_IMAGE
          args TOOLS_ARGS
        }
      }
      steps {

        sh '''\
            #!/bin/bash

            deno test --allow-all test/*
        '''.stripIndent()
      }
    }

    stage('Lint'){
      agent {
        docker {
          image TOOLS_IMAGE
          args TOOLS_ARGS
        }
      }
      steps {

        sh '''\
            #!/bin/bash
            
            deno lint src
        '''.stripIndent()
      }
    }
    
    stage('Format') {
      agent {
        docker {
          image TOOLS_IMAGE
          args TOOLS_ARGS
        }
      }
      steps {

        sh '''\
            #!/bin/bash
            
            echo "Remove old test files"
            find test -name ".*.json" -exec rm {} \\;

            deno fmt --check src test
        '''.stripIndent()
      }
    }
  }
}
