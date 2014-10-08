var gulp = require('gulp');
var fs = require('fs');

var concat = require('gulp-concat');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var header = require('gulp-header');

var banner = fs.readFileSync('copyright-banner.txt');

gulp.task('dist', function () {
  gulp
    .src('src/**/*.js')
    .pipe(concat('chrome-nfc.js'))
    .pipe(gulp.dest('dist'))
    .pipe(rename('chrome-nfc.min.js'))
    .pipe(uglify())
    .pipe(header(banner))
    .pipe(gulp.dest('dist'));
});

gulp.task('default', ['dist']);
