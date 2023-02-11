TOOLS_IMAGE = "denoland/deno:latest"
TOOLS_ARGS = '-e DENO_DIR=/tmp/deno --rm --volume /var/run/docker.sock:/var/run/docker.sock --volume /tmp:/tmp'

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
//     stage( 'init'){
//        steps {
//       sh '''\
//       mkdir -p .deno
//       '''
//        }
//     }
    stage('Build') {
      agent {
        docker {
          image TOOLS_IMAGE
          args TOOLS_ARGS
        }
      }
      steps {

        sh '''\
            #!/bin/bash
            set -ex
            pwd
            ls -l 
            ls -lR /deno-dir
            deno test --allow-all test/*
        '''.stripIndent()
      }
    }
  }
}
